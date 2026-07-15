/**
 * Pure CI bundle assembler — ZERO I/O imports (no fs, drizzle, octokit, fastify).
 *
 * Takes all resolved inputs and returns the full CiFile[] set.
 * The caller (service.ts) is responsible for reading the runner bytes from disk
 * before calling this function.
 *
 * Only `target: 'gha'` (GitHub Actions) is supported. Requests for other targets
 * are rejected upstream by service.ts before this function is reached — so this
 * function builds the real 6-file bundle unconditionally.
 *
 * The bundle contains:
 *   .devdigest/agents/<slug>.yaml         — agent manifest (generated)
 *   .devdigest/skills/<slug>.md           — one per linked skill
 *   .devdigest/memory.jsonl               — empty, runner reads it for memory injection
 *   .devdigest/runner/index.js            — self-contained ncc bundle
 *   .github/workflows/devdigest-review.yml — GitHub Actions workflow
 */
import type { CiFile, CiTarget } from '@devdigest/shared';
import { buildManifestYaml, slugify, type AgentConfig } from './manifest.js';
import { buildWorkflowYaml, WORKFLOW_FILE_NAME } from './workflow.js';

export interface SkillBody {
  /** Filesystem-safe slug (used as the filename: `.devdigest/skills/<slug>.md`). */
  slug: string;
  /** Full markdown body of the skill. */
  body: string;
}

export interface BundleInput {
  agent: AgentConfig;
  skillBodies: SkillBody[];
  postAs: string;
  triggers: string[];
  target: CiTarget;
  /** Runner bytes (ncc bundle). The caller reads these from disk. */
  runnerBytes: Buffer;
}

/**
 * Assemble the GitHub Actions CI bundle.
 *
 * Returns all files needed to set up DevDigest in a GitHub Actions workflow.
 * `runnerBytes` must be the real ncc bundle. Non-gha targets are rejected
 * upstream in service.ts before this function is called.
 */
export function buildCiBundle(input: BundleInput): CiFile[] {
  const { yaml: manifestYaml, slug: agentSlug } = buildManifestYaml(input.agent);
  const workflowYaml = buildWorkflowYaml({ postAs: input.postAs, triggers: input.triggers });

  const files: CiFile[] = [];

  // 1. Agent manifest
  files.push({
    path: `.devdigest/agents/${agentSlug}.yaml`,
    contents: manifestYaml,
    editable: true,
  });

  // 2. Skill bodies — one file per linked skill
  for (const skill of input.skillBodies) {
    files.push({
      path: `.devdigest/skills/${skill.slug}.md`,
      contents: skill.body,
      editable: true,
    });
  }

  // 3. Empty memory file — runner reads this for memory injection (AC-36 parity)
  files.push({
    path: '.devdigest/memory.jsonl',
    contents: '',
    editable: false,
  });

  // 4. Runner — the self-contained ncc bundle (not editable — it's a binary-like JS)
  files.push({
    path: '.devdigest/runner/index.js',
    contents: input.runnerBytes.toString('utf8'),
    editable: false,
  });

  // 5. GitHub Actions workflow
  files.push({
    path: `.github/workflows/${WORKFLOW_FILE_NAME}`,
    contents: workflowYaml,
    editable: true,
  });

  return files;
}

/** Derive the skill slug from the skill's display name. */
export function skillSlugFromName(name: string): string {
  return slugify(name);
}
