import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';

// Config files to scan at repo root for convention hints.
export const CONFIG_GLOBS = [
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs',
  '.eslintrc.yaml', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs',
  'eslint.config.ts', '.prettierrc', '.prettierrc.json', '.prettierrc.js',
  '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js',
  'tsconfig.json', 'tsconfig.base.json',
  'biome.json', 'biome.jsonc', '.editorconfig',
];

// Max chars to include per file in the LLM context.
const MAX_FILE_CHARS = 3000;
// Max total chars for the combined sample context.
const MAX_TOTAL_CHARS = 24_000;

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

export type ConventionCandidate = z.infer<typeof LlmCandidate>;

export interface ExtractResult {
  candidates: ConventionCandidate[];
  sampleCount: number;
  error?: string;
}

export async function extractConventions(
  container: Container,
  workspaceId: string,
  repoId: string,
  repoName: string,
  localPath: string,
): Promise<ExtractResult> {
  // 1. Collect top-N source files via repo-intel.
  const topFiles = await container.repoIntel.getConventionSamples(repoId, 12);

  // 2. Collect config files present at repo root.
  const configFiles: string[] = [];
  for (const cfg of CONFIG_GLOBS) {
    try {
      await fs.access(path.join(localPath, cfg));
      configFiles.push(cfg);
    } catch {
      // not present — skip
    }
  }

  // 3. Build sample context (trimmed to budget).
  const sampleFiles = [...configFiles, ...topFiles];
  let context = '';
  for (const rel of sampleFiles) {
    if (context.length >= MAX_TOTAL_CHARS) break;
    try {
      const content = await fs.readFile(path.join(localPath, rel), 'utf-8');
      context += `\n\n### ${rel}\n\`\`\`\n${content.slice(0, MAX_FILE_CHARS)}\n\`\`\``;
    } catch {
      // unreadable — skip
    }
  }
  const sampleCount = sampleFiles.length;

  if (!context.trim()) {
    return {
      candidates: [],
      sampleCount,
      error: `No readable files found for repo ${repoName} (${sampleFiles.length} candidates, all unreadable). Is the repo indexed?`,
    };
  }

  // 4. Resolve feature model and call LLM.
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'conventions');
  console.info(`[conventions] calling ${provider}/${model} with ${sampleCount} sample files`);

  let rawCandidates: ConventionCandidate[] = [];
  try {
    const llm = await container.llm(provider);
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
          content: `Repository: ${repoName}\n\nFiles:\n${context}`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.1,
    });
    rawCandidates = result.data.candidates;
    console.info(`[conventions] LLM returned ${rawCandidates.length} candidate(s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[conventions] LLM call failed (${provider}/${model}): ${msg}`);
    return {
      candidates: [],
      sampleCount,
      error: `LLM call failed (${provider}/${model}): ${msg}`,
    };
  }

  // 5. Validate evidence: file must exist and have enough lines.
  //    Snippet text matching is intentionally skipped — LLMs often reformat
  //    whitespace, causing false rejections of valid candidates.
  const candidates: ConventionCandidate[] = [];
  for (const c of rawCandidates) {
    try {
      const content = await fs.readFile(path.join(localPath, c.evidence.file), 'utf-8');
      const lineCount = content.split('\n').length;
      if (c.evidence.lineEnd > lineCount) {
        console.warn(`[conventions] discarding "${c.rule}" — lineEnd ${c.evidence.lineEnd} > file length ${lineCount}`);
        continue;
      }
      candidates.push(c);
    } catch {
      console.warn(`[conventions] discarding "${c.rule}" — file not found: ${c.evidence.file}`);
    }
  }
  console.info(`[conventions] ${candidates.length}/${rawCandidates.length} candidate(s) passed evidence validation`);

  return { candidates, sampleCount };
}
