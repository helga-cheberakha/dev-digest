import type { CiFailOn, Finding, Severity } from '@devdigest/shared';
import { gateTriggered } from '@devdigest/reviewer-core';
import { SEV_RANK } from '@devdigest/reviewer-core/output/to-review.js';

/**
 * Terminal output renderer for the `pre-review` CLI.
 *
 * Three named exports:
 *   - renderFindings  — prints structured findings to stdout
 *   - renderSummary   — prints a compact cost/token line to stderr
 *   - resolveExitCode — maps findings + gate policy to a process exit code
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Gate policy — controls which findings block (exit 1) the run. */
export type FailOnPolicy = CiFailOn;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RATIONALE_TRUNCATE_LEN = 300;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…'; // …
}

// ---------------------------------------------------------------------------
// renderFindings
// ---------------------------------------------------------------------------

/**
 * Write structured findings to stdout.
 *
 * - Header: `DevDigest Pre-Review — N finding(s)`
 * - Findings sorted CRITICAL → WARNING → SUGGESTION, each with:
 *     `[SEVERITY] file:start_line`
 *     `  title`
 *     `  rationale` (truncated to ~300 chars unless verbose)
 *     `  Fix: suggestion` (when present)
 * - Trailing summary: `N critical · N warning · N suggestion`
 * - "No findings" message when the list is empty.
 */
export function renderFindings(
  findings: Finding[],
  opts: { verbose?: boolean } = {},
): void {
  const verbose = opts.verbose ?? false;
  const out = (line: string): void => {
    process.stdout.write(line + '\n');
  };

  out(`DevDigest Pre-Review — ${findings.length} finding(s)`);
  out('');

  if (findings.length === 0) {
    out('No findings. Looks good!');
    return;
  }

  // Sort by severity rank descending (CRITICAL first), preserving insertion
  // order within the same severity for determinism.
  const sorted = [...findings].sort(
    (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0),
  );

  for (const finding of sorted) {
    out(`[${finding.severity}] ${finding.file}:${finding.start_line}`);
    out(`  ${finding.title}`);
    const rationale = verbose
      ? finding.rationale
      : truncate(finding.rationale, RATIONALE_TRUNCATE_LEN);
    out(`  ${rationale}`);
    if (finding.suggestion) {
      out(`  Fix: ${finding.suggestion}`);
    }
    out('');
  }

  // Trailing severity-count summary.
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  out(
    `${counts.CRITICAL} critical · ${counts.WARNING} warning · ${counts.SUGGESTION} suggestion`,
  );
}

// ---------------------------------------------------------------------------
// renderSummary
// ---------------------------------------------------------------------------

/**
 * Write a compact grounding / token / cost summary to stderr.
 * stderr keeps stdout clean for machine consumers (pipes, CI artifact parsers).
 */
export function renderSummary(outcome: {
  grounding: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}): void {
  const cost = outcome.costUsd != null ? `$${outcome.costUsd.toFixed(4)}` : 'n/a';
  process.stderr.write(
    `Grounding: ${outcome.grounding} | tokens in: ${outcome.tokensIn} out: ${outcome.tokensOut} | cost: ${cost}\n`,
  );
}

// ---------------------------------------------------------------------------
// resolveExitCode
// ---------------------------------------------------------------------------

/**
 * Determine the process exit code given the findings and gate policy.
 *
 * Returns `1` when at least one finding trips the gate (i.e. its severity rank
 * is >= the policy's minimum rank).  Returns `0` otherwise.
 * The `'never'` policy always returns `0` regardless of findings.
 */
export function resolveExitCode(findings: Finding[], failOn: FailOnPolicy): number {
  return gateTriggered(findings, failOn) ? 1 : 0;
}
