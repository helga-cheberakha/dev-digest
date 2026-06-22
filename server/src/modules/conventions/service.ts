import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { Convention, ExtractConventionsResult } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository } from '../repos/repository.js';
import {
  ConventionsRepository,
  toConventionDto,
  type UpdateConvention,
} from './repository.js';

// Config files to scan at repo root for convention hints.
const CONFIG_GLOBS = [
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs',
  '.eslintrc.yaml', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs',
  'eslint.config.ts', '.prettierrc', '.prettierrc.json', '.prettierrc.js',
  '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js',
  'tsconfig.json', 'tsconfig.base.json',
];

// Max chars to include per file in the LLM context.
const MAX_FILE_CHARS = 3000;
// Max total chars for the combined sample context.
const MAX_TOTAL_CHARS = 24_000;

// LLM response schema for convention candidates.
const LlmCandidate = z.object({
  category: z.string(),
  rule: z.string(),
  evidence: z.object({
    file: z.string(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  }),
  snippet: z.string(),
  confidence: z.number().min(0).max(1),
});

const LlmResponse = z.object({
  candidates: z.array(LlmCandidate),
});

export interface UpdateConventionInput {
  status?: 'pending' | 'accepted' | 'rejected';
  rule?: string;
  snippet?: string;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private reposRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.reposRepo = new RepoRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<Convention[]> {
    const rows = await this.repo.listForRepo(repoId);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    repoId: string,
    id: string,
    patch: UpdateConventionInput,
  ): Promise<Convention | undefined> {
    const row = await this.repo.update(workspaceId, id, patch as UpdateConvention);
    return row ? toConventionDto(row) : undefined;
  }

  async extract(workspaceId: string, repoId: string): Promise<ExtractConventionsResult> {
    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    if (!repoRow?.clonePath) {
      const msg = `Repository not cloned yet (clonePath is null for repo ${repoId}). Sync the repo first.`;
      console.error(`[conventions] ${msg}`);
      return { conventions: [], sample_count: 0, scanned_at: new Date().toISOString(), error: msg };
    }
    const localPath = repoRow.clonePath;

    // 1. Collect top-N source files via repo-intel.
    const topFiles = await this.container.repoIntel.getConventionSamples(repoId, 12);

    // 2. Collect config files.
    const configFiles: string[] = [];
    for (const cfg of CONFIG_GLOBS) {
      const abs = path.join(localPath, cfg);
      try {
        await fs.access(abs);
        configFiles.push(cfg);
      } catch {
        // file doesn't exist — skip
      }
    }

    // 3. Build sample context (trimmed to budget).
    const sampleFiles = [...configFiles, ...topFiles];
    let context = '';
    for (const rel of sampleFiles) {
      if (context.length >= MAX_TOTAL_CHARS) break;
      const abs = path.join(localPath, rel);
      try {
        const content = await fs.readFile(abs, 'utf-8');
        const trimmed = content.slice(0, MAX_FILE_CHARS);
        context += `\n\n### ${rel}\n\`\`\`\n${trimmed}\n\`\`\``;
      } catch {
        // unreadable — skip
      }
    }
    const sampleCount = sampleFiles.length;

    if (!context.trim()) {
      const msg = `No readable files found for repo ${repoRow.fullName} (${sampleFiles.length} candidates, all unreadable). Is the repo indexed?`;
      console.error(`[conventions] ${msg}`);
      return { conventions: [], sample_count: sampleCount, scanned_at: new Date().toISOString(), error: msg };
    }

    // 4. Resolve feature model (falls back to registry default).
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'conventions',
    );

    console.info(`[conventions] calling ${provider}/${model} with ${sampleCount} sample files`);

    let candidates: z.infer<typeof LlmCandidate>[] = [];
    try {
      const llm = await this.container.llm(provider);
      const result = await llm.completeStructured({
        model,
        schema: LlmResponse,
        schemaName: 'ConventionCandidates',
        messages: [
          {
            role: 'system',
            content: `You are a senior code reviewer. Analyze the following repository files and extract coding conventions — patterns that MUST be followed throughout this codebase.

Return JSON with a "candidates" array. Each candidate must have:
- category: short category label (e.g. "async-style", "typing", "imports")
- rule: a single directive sentence starting with a verb (e.g. "Always use async/await instead of .then() chains")
- evidence: { file: relative path, lineStart: integer, lineEnd: integer }
- snippet: exact code lines from the evidence location (copy verbatim)
- confidence: float 0-1 (how strongly this pattern is enforced in the repo)

Rules:
- Only report conventions you see evidence of in multiple places or in config files.
- Confidence >0.8 = enforced everywhere. 0.5-0.8 = common but not universal. <0.5 = optional.
- Cite only files present in the provided samples.
- Line numbers must be accurate for the snippets shown.
- Return 3-8 candidates maximum.`,
          },
          {
            role: 'user',
            content: `Repository: ${repoRow.fullName}\n\nFiles:\n${context}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.1,
      });
      candidates = result.data.candidates;
      console.info(`[conventions] LLM returned ${candidates.length} candidate(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[conventions] LLM call failed (${provider}/${model}): ${msg}`);
      return {
        conventions: [],
        sample_count: sampleCount,
        scanned_at: new Date().toISOString(),
        error: `LLM call failed (${provider}/${model}): ${msg}`,
      };
    }

    // 5. Validate evidence: file must exist and have enough lines.
    //    Snippet text matching is intentionally skipped — LLMs often reformat
    //    whitespace, causing false rejections of valid candidates.
    const validated: typeof candidates = [];
    for (const c of candidates) {
      const abs = path.join(localPath, c.evidence.file);
      try {
        const content = await fs.readFile(abs, 'utf-8');
        const lines = content.split('\n');
        if (c.evidence.lineEnd > lines.length) {
          console.warn(`[conventions] discarding candidate "${c.rule}" — lineEnd ${c.evidence.lineEnd} > file length ${lines.length}`);
          continue;
        }
        validated.push(c);
      } catch {
        console.warn(`[conventions] discarding candidate "${c.rule}" — file not found: ${c.evidence.file}`);
      }
    }
    console.info(`[conventions] ${validated.length}/${candidates.length} candidate(s) passed evidence validation`);

    // 6. Persist: clear stale, insert new pending candidates.
    await this.repo.deleteStale(repoId);
    const rows = await this.repo.insertBatch(
      validated.map((c) => ({
        workspaceId,
        repoId,
        category: c.category,
        rule: c.rule,
        filePath: c.evidence.file,
        lineStart: c.evidence.lineStart,
        lineEnd: c.evidence.lineEnd,
        snippet: c.snippet,
        confidence: c.confidence,
      })),
    );

    return {
      conventions: rows.map(toConventionDto),
      sample_count: sampleCount,
      scanned_at: new Date().toISOString(),
    };
  }
}
