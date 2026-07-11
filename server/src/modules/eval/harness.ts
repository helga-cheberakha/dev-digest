import type { Container } from '../../platform/container.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { REVIEW_STRATEGY } from './constants.js';
import type { EvalCaseRunInput, EvalRunOutput } from './run.js';

/**
 * Fixed configuration used for every skill-eval run.
 *
 * - provider / model: pinned to the same openrouter/deepseek-v4-flash that the
 *   seeded built-in agents use (DEFAULT_PROVIDER / DEFAULT_MODEL in seed.ts),
 *   so container.llm('openrouter') is always available when OPENROUTER_API_KEY
 *   is set.
 * - strategy: single-pass (same default as agent eval runs, see constants.ts).
 * - systemPrompt: neutral baseline PR-reviewer persona; the only per-run
 *   variable is the injected skill body passed as the `skills` array — the
 *   system prompt itself never changes between skill-eval runs.
 */
export const SKILL_EVAL_HARNESS = {
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-v4-flash',
  strategy: REVIEW_STRATEGY,
  systemPrompt: `You are a precise, objective code reviewer. Your role is to read the provided pull-request diff carefully and surface findings that are clearly supported by the diff content. Apply any reviewer rules supplied to you exactly as written. Focus only on issues that are directly observable in the diff — do not speculate about code not shown. Each finding must cite the exact file and line range from the diff that justifies it.`,
} as const;

/**
 * runSkillCase — skill-focused eval execution path.
 *
 * Drives `reviewPullRequest` with a fixed harness config and a single skill
 * body injected as the `skills` array. Deliberately omits callers, repoMap,
 * intent, prDescription, specs, and task — this run path MUST NOT perform live
 * repo-intel enrichment so that two executions of the same eval case differ
 * only by the skill body under test, never by drifting repo context.
 *
 * Do NOT route this through ReviewRunExecutor — that path builds a full PR row
 * and performs live repo-intel enrichment, violating the isolation guarantee.
 * Do NOT resolve any agent config or agent-linked skills — the `skillBody`
 * parameter is the ONLY skills input.
 */
export async function runSkillCase(
  container: Container,
  skillBody: string,
  evalCase: EvalCaseRunInput,
): Promise<EvalRunOutput> {
  // Parse the frozen diff. An empty or null input produces { raw: '', files: [] }
  // — a valid UnifiedDiff — and never throws.
  const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');

  // Resolve the harness LLM provider via the DI container.
  // container.llm throws ConfigError when the provider key is not configured.
  const llm = await container.llm(SKILL_EVAL_HARNESS.provider);

  // Drive the pure review engine with only frozen, harness-owned inputs.
  // callers / repoMap / intent / prDescription / specs / task are ALL omitted
  // on purpose — see function docstring above.
  const outcome = await reviewPullRequest({
    systemPrompt: SKILL_EVAL_HARNESS.systemPrompt,
    model: SKILL_EVAL_HARNESS.model,
    diff,
    llm,
    strategy: SKILL_EVAL_HARNESS.strategy,
    skills: [skillBody],
  });

  const findings = outcome.review.findings;
  const kept = findings.length;
  const produced = kept + outcome.dropped.length;
  const costUsd = outcome.costUsd;

  return { findings, kept, produced, costUsd };
}
