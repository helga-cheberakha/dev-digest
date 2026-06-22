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
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().transform((v) => Math.min(1, Math.max(0, v > 1 ? v / 100 : v))),
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
          content: `You are a code-convention analyst.

Analyze the provided code samples and extract concrete coding conventions
consistently followed in this repository.

Return ONLY conventions that:

- have clear evidence in the provided files
- can be formulated as a specific actionable rule
  (start with Always, Never, or Use X instead of Y)
- appear in at least 2 places or are configured explicitly
- would be useful for a code reviewer to enforce

Do NOT include:

- generic best practices obvious to any TypeScript developer
- conventions supported by only one example unless defined in a config file
- framework defaults`,
        },
        {
          role: 'user',
          content: `Repository: ${repoName}

Analyze these files and extract coding conventions:

${context}

Return JSON with candidates array:

- rule (imperative form)
- evidence_path (relative path)
- evidence_snippet (2–5 lines of exact code)
- confidence (0.0–1.0)

Only include conventions with confidence > 0.6.`,
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

  // 5. Validate evidence: file must exist and the first line of evidence_snippet
  //    must literally appear in that file to reject hallucinated references.
  const candidates: ConventionCandidate[] = [];
  for (const c of rawCandidates) {
    try {
      const content = await fs.readFile(path.join(localPath, c.evidence_path), 'utf-8');
      const firstLine = (c.evidence_snippet.split('\n')[0] ?? '').trim();
      if (firstLine && !content.includes(firstLine)) {
        console.warn(`[conventions] discarding "${c.rule}" — first snippet line not found in ${c.evidence_path}`);
        continue;
      }
      candidates.push(c);
    } catch {
      console.warn(`[conventions] discarding "${c.rule}" — file not found: ${c.evidence_path}`);
    }
  }
  console.info(`[conventions] ${candidates.length}/${rawCandidates.length} candidate(s) passed evidence validation`);

  return { candidates, sampleCount };
}
