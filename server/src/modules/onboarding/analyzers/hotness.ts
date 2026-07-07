/**
 * Commit-frequency hotness analyzer.
 *
 * Computes a normalized commit-frequency score (0..1) for a bounded set of
 * reading-path candidate files. The 90-day window filter is applied here,
 * keeping all windowing logic co-located with the constant it enforces.
 *
 * The service (T10) is responsible for calling git.log path-scoped, once per
 * candidate file, supplying at most HOTNESS_CANDIDATE_MAX entries in
 * commitsByPath. It must never perform a repo-wide log call.
 */

import type { GitCommit } from '@devdigest/shared';

/**
 * Maximum number of reading-path candidate files for which the service
 * should perform path-scoped git log calls.
 *
 * Bounding this here documents the contract for the service: pass at most
 * HOTNESS_CANDIDATE_MAX entries so the git-log fan-out is O(N) and never
 * degrades into an unbounded repo-wide history walk.
 */
export const HOTNESS_CANDIDATE_MAX = 20;

/**
 * Compute a normalized hotness score (0..1) for each candidate file.
 *
 * The score represents relative commit frequency within the look-back window:
 * the most active file in the candidate set receives 1.0; all others are
 * scaled proportionally. A file with no commits in the window — or with no
 * history at all — receives 0.
 *
 * @param commitsByPath  Map of file path → git commits for that path.
 *                       The service must supply at most HOTNESS_CANDIDATE_MAX
 *                       entries. A path present in the map but with an empty
 *                       array receives hotness = 0.
 * @param windowDays     Look-back window in calendar days (default 90).
 *                       Commits whose date falls outside this window are
 *                       excluded. GitCommit.date is a string — this function
 *                       parses it with `new Date()` before comparing, per the
 *                       known gotcha in the plan.
 * @returns Map<path, hotness> where hotness ∈ [0, 1]. An empty input map
 *          returns an empty result map (hotness = 0 for all callers).
 */
export function computeHotness(
  commitsByPath: Map<string, GitCommit[]>,
  windowDays = 90,
): Map<string, number> {
  const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  // Count commits within the window per file.
  // GitCommit.date is a string — parse with new Date() before windowing.
  const counts = new Map<string, number>();
  for (const [path, commits] of commitsByPath) {
    const recent = commits.filter((c) => {
      const ts = new Date(c.date).getTime();
      return Number.isFinite(ts) && ts >= cutoffMs;
    }).length;
    counts.set(path, recent);
  }

  // Normalize to [0, 1] relative to the most-active file in the candidate set.
  // If every file has zero recent commits, all scores remain 0.
  let max = 0;
  for (const n of counts.values()) {
    if (n > max) max = n;
  }

  const result = new Map<string, number>();
  for (const [path, count] of counts) {
    result.set(path, max === 0 ? 0 : count / max);
  }
  return result;
}
