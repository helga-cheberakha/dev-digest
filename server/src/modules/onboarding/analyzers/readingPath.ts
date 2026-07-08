/**
 * Reading-path builder.
 *
 * Orders candidate files by combined rank = pagerank × (1 + hotness) and
 * emits the top 3–5 entries as ReadingPathEntry items with deterministic
 * rationale text. Links are constructed by the caller (service, T10) via a
 * pure buildLink callback from repo.fullName + headSha — this module never
 * performs any I/O.
 */

import type { ReadingPathEntry } from '@devdigest/shared';

/** Maximum entries to emit (matches schema .max(5)). */
const MAX_ENTRIES = 5;

/**
 * Minimal rank-row shape accepted from the service.
 *
 * Mirrors FileRankRow from repo-intel/types.ts without importing it directly,
 * keeping this analyzer I/O-free and independent of the repo-intel module's
 * internal types.
 */
export interface ReadingPathRankRow {
  path: string;
  /**
   * Pagerank percentile in 0..100 scale (top file ≈ 100).
   * Produced by `getTopFilesByRank` / `getFileRank` from the RepoIntel facade.
   */
  percentile: number;
}

/**
 * Build the reading-path section deterministically.
 *
 * Each candidate is scored as: combined = percentile × (1 + hotness).
 * Entries are sorted descending and the top MAX_ENTRIES (≤ 5) are returned.
 *
 * On the LLM-success path the service feeds these entries as facts into the
 * prompt (T8); the LLM may enrich or rewrite rationale prose. On the degraded/
 * skeleton path these entries are returned as-is with deterministic rationale.
 *
 * @param rankRows   Candidate files with their pagerank percentile.
 *                   An empty array returns an empty reading path, which is valid
 *                   under the schema's .max()-only constraint (no .min()).
 * @param hotness    Map<path, score 0..1> produced by computeHotness.
 *                   Paths absent from the map are treated as hotness = 0.
 * @param buildLink  Pure function that constructs an open-file URL for a given
 *                   relative path. Supplied by the service from repo.fullName
 *                   and headSha, e.g.:
 *                   `(p) => \`https://github.com/${fullName}/blob/${sha}/${p}\``
 * @returns ReadingPathEntry[] (length 0..MAX_ENTRIES), ordered by descending
 *          combined rank.
 */
export function buildReadingPath(
  rankRows: ReadingPathRankRow[],
  hotness: Map<string, number>,
  buildLink: (path: string) => string,
): ReadingPathEntry[] {
  if (rankRows.length === 0) return [];

  // Score each candidate and sort descending
  const scored = rankRows
    .map((row) => {
      const h = hotness.get(row.path) ?? 0;
      return {
        path: row.path,
        percentile: row.percentile,
        hotness: h,
        combined: row.percentile * (1 + h),
      };
    })
    .sort((a, b) => b.combined - a.combined);

  const top = scored.slice(0, MAX_ENTRIES);

  return top.map((item, index) => ({
    file: item.path,
    rationale: buildRationale(item.percentile, item.hotness, index),
    link: buildLink(item.path),
  }));
}

/**
 * Produce a deterministic one-line rationale for a reading-path entry.
 *
 * Used on the degraded/skeleton path and as a fact hint in the LLM prompt.
 * The LLM may replace this text with richer prose on the happy path.
 */
function buildRationale(percentile: number, hotness: number, rank: number): string {
  const pct = Math.round(percentile);
  if (rank === 0) {
    return hotness > 0.5
      ? `Most important frequently-changed file (top ${pct}th percentile, actively maintained)`
      : `Most important file in the codebase (top ${pct}th percentile by pagerank)`;
  }
  if (hotness > 0.5) {
    return `High-importance actively-changing file (${pct}th percentile)`;
  }
  return `Key module in the codebase (${pct}th percentile by pagerank)`;
}
