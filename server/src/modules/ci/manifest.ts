/**
 * Pure manifest generator — ZERO I/O imports (no fs, drizzle, octokit, fastify).
 *
 * Serializes an agent's config to a validated AgentManifest YAML string that
 * the CI runner reads via `yaml.parse()` + `AgentManifest.parse()`.
 *
 * Onion gate: this file imports ONLY from @devdigest/shared (contracts) and the
 * node stdlib. Any I/O (fs.readFile, db query) lives in service.ts.
 */
import { AgentManifest, type AgentManifest as AgentManifestType } from '@devdigest/shared';

export type { AgentManifestType as AgentManifest };

/**
 * Convert a human name to a filesystem-safe slug.
 * "Security Reviewer" → "security-reviewer"
 * "PR Quality Rubric" → "pr-quality-rubric"
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'agent';
}

export interface AgentConfig {
  name: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  skillSlugs: string[];
  strategy: 'auto' | 'single-pass' | 'map-reduce';
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
}

export interface ManifestResult {
  /** Validated YAML string ready to write to .devdigest/agents/<slug>.yaml */
  yaml: string;
  /** Agent slug derived from name (used as the manifest filename). */
  slug: string;
  /** The parsed, validated manifest object. */
  manifest: AgentManifest;
}

/**
 * Serialize the agent config to a validated YAML string.
 *
 * `AgentManifest.parse()` is called BEFORE returning — this is a build-time
 * contract check, not a runtime user error. If the generated YAML doesn't
 * round-trip through the schema, it throws loudly.
 *
 * NOTE: `post_as` must NEVER appear here — it is deliberately absent from
 * `AgentManifest` (the runner reads it from the DEVDIGEST_POST_AS env var
 * instead, see workflow.ts).
 */
export function buildManifestYaml(config: AgentConfig): ManifestResult {
  const slug = slugify(config.name);

  // Validate BEFORE serializing — fail loudly on contract mismatch.
  const manifest = AgentManifest.parse({
    name: config.name,
    provider: config.provider,
    model: config.model,
    system_prompt: config.systemPrompt,
    skills: config.skillSlugs,
    strategy: config.strategy,
    ci_fail_on: config.ciFailOn,
  });

  const yaml = serializeManifest(manifest);
  return { yaml, slug, manifest };
}

// ---------------------------------------------------------------------------
// Internal YAML serializer (minimal — only handles the AgentManifest shape)
// ---------------------------------------------------------------------------

/**
 * Wrap a string in double quotes if it contains characters that have special
 * meaning in YAML (colon, brackets, pipes, octothorps, etc.) or could be
 * mis-parsed as a boolean/null/number.
 */
function yamlScalar(value: string): string {
  if (value === '') return '""';
  const needsQuoting =
    /[:#,\[\]{}&*!|>'"\\@`%]/.test(value) ||
    /^[?~]/.test(value) ||
    /^(true|false|null|yes|no|on|off)$/i.test(value) ||
    /^\s|\s$/.test(value);
  if (needsQuoting) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  return value;
}

function serializeManifest(m: AgentManifest): string {
  const lines: string[] = [];

  lines.push(`name: ${yamlScalar(m.name)}`);
  lines.push(`provider: ${m.provider}`);
  lines.push(`model: ${yamlScalar(m.model)}`);

  // system_prompt — always use literal block scalar so any multi-line text
  // round-trips cleanly through yaml.parse() in the runner.
  const normalized = m.system_prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.length === 0) {
    lines.push('system_prompt: ""');
  } else {
    lines.push('system_prompt: |');
    for (const line of normalized.split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  // skills — list of slugs
  if (m.skills.length === 0) {
    lines.push('skills: []');
  } else {
    lines.push('skills:');
    for (const slug of m.skills) {
      lines.push(`  - ${yamlScalar(slug)}`);
    }
  }

  lines.push(`strategy: ${m.strategy}`);
  lines.push(`ci_fail_on: ${m.ci_fail_on}`);

  return lines.join('\n') + '\n';
}
