import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import type { Finding } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { REVIEW_STRATEGY } from './constants.js';

/**
 * Minimal eval-case input required by runCase. The caller (service or test)
 * supplies the frozen diff text; null / undefined is treated as an empty diff.
 */
export interface EvalCaseRunInput {
  inputDiff: string | null | undefined;
}

/**
 * Return shape from runCase.
 *
 * `kept`     = findings that survived the citation-grounding gate (= findings.length).
 * `produced` = total findings the model raised before grounding dropped any.
 *
 * The eval scorer uses kept / produced to compute recall, precision, and
 * citation accuracy without needing to re-run grounding itself.
 */
export interface EvalRunOutput {
  findings: Finding[];
  /** Alias for findings.length — findings that passed grounding. */
  kept: number;
  /** Total findings before grounding: kept + dropped. */
  produced: number;
}

/**
 * runCase — frozen-input eval execution path.
 *
 * Drives `reviewPullRequest` with the agent's own config and a frozen diff
 * (from the eval case). Deliberately omits callers, repoMap, intent,
 * prDescription, specs, and task — this run path MUST NOT perform live
 * repo-intel enrichment so that two executions of the same case differ only
 * by the agent's own config, never by drifting repo context.
 *
 * The untrusted `inputDiff` reaches the model only through
 * `reviewPullRequest`'s own `assemblePrompt` / `wrapUntrusted` internals —
 * it is never hand-concatenated into the system prompt here.
 *
 * Do NOT route this through ReviewRunExecutor — that path builds a full PR
 * row and performs live repo-intel enrichment, which would make two eval runs
 * of "the same" case non-comparable over time.
 */
export async function runCase(
  container: Container,
  agent: AgentRow,
  skillBodies: string[],
  evalCase: EvalCaseRunInput,
): Promise<EvalRunOutput> {
  // Parse the frozen diff. An empty or null input produces { raw: '', files: [] }
  // — a valid UnifiedDiff — and never throws.
  const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');

  // Resolve the agent's LLM provider via the DI container.
  // container.llm throws ConfigError when the key is not configured.
  const llm = await container.llm(agent.provider as 'openai' | 'anthropic' | 'openrouter');

  // Drive the pure review engine with only frozen, agent-owned inputs.
  // callers / repoMap / intent / prDescription / specs / task are ALL omitted
  // on purpose — see function docstring above.
  const outcome = await reviewPullRequest({
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    diff,
    llm,
    strategy: agent.strategy ?? REVIEW_STRATEGY,
    ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
  });

  const findings = outcome.review.findings;
  const kept = findings.length;
  const produced = kept + outcome.dropped.length;

  return { findings, kept, produced };
}
