/**
 * Critical-path entry builder.
 *
 * Converts the dependency chains produced by `container.repoIntel.getCriticalPaths`
 * into 5–8 `CriticalPathEntry` items, each with a one-line deterministic rationale
 * and an open-file link.
 *
 * Constraints:
 * - Pure function — no I/O. The caller (service, T10) passes in the chains and a
 *   `buildLink` callback that constructs links from `repo.fullName` + `headSha`.
 * - Rejects any chain entry that does not look like a file path (last segment must
 *   contain a period). This filters bare package/service/module names that do not
 *   map to a file on disk (AC-12).
 * - Returns [] when chains is empty (degraded / no-index skeleton case) — never throws.
 * - The happy-path minimum (≥ 5 entries) is enforced by the service layer (T10),
 *   not here — the schema carries .max(8) only, no .min().
 */

import type { CriticalPathEntry } from '@devdigest/shared';

/** Maximum number of critical-path entries to emit (matches schema .max(8)). */
const CRITICAL_PATHS_MAX = 8;

/**
 * Returns true if the given path looks like a file (its last segment contains a
 * period, indicating a file extension). Bare names such as `express`, `auth-service`,
 * or `src/services/auth` are rejected.
 */
function isFilePath(path: string): boolean {
  const lastSegment = path.split('/').pop() ?? '';
  return lastSegment.includes('.');
}

/**
 * Build critical-path entries from dependency chain data (AC-12).
 *
 * The function scores every unique file that appears in the chains by its
 * structural position: being the root (position 0) of an early chain earns the
 * highest score; deep positions in later chains earn less. Non-file entries are
 * filtered out. The top CRITICAL_PATHS_MAX entries are returned.
 *
 * @param chains     Dependency chains from `getCriticalPaths`. Each chain is an
 *                   ordered sequence of file paths [root, …, leaf]. An empty
 *                   array is valid (degraded / no-index skeleton case) and
 *                   returns [].
 * @param buildLink  Pure function that constructs an open-file URL from a
 *                   relative path. Supplied by the service from repo.fullName
 *                   and headSha, e.g.:
 *                   `(p) => \`https://github.com/${fullName}/blob/${sha}/${p}\``
 * @returns CriticalPathEntry[] (length 0..CRITICAL_PATHS_MAX), ordered by
 *          descending structural importance within the chains.
 */
export function buildCriticalPaths(
  chains: string[][],
  buildLink: (path: string) => string,
): CriticalPathEntry[] {
  if (chains.length === 0) return [];

  // Compute an importance score for each unique file across all chains.
  // Earlier chains and earlier positions within a chain signal higher importance.
  //   score contribution = 1 / (1 + chainIndex) / (1 + positionInChain)
  // This means the root (pos=0) of chain 0 gets score 1, which is the maximum.
  const scores = new Map<string, number>();
  const chainCount = chains.length;

  for (let ci = 0; ci < chainCount; ci++) {
    const chain = chains[ci] ?? [];
    const chainLen = chain.length;
    for (let pi = 0; pi < chainLen; pi++) {
      const file = chain[pi];
      if (!file) continue;
      const contribution = 1 / (1 + ci) / (1 + pi);
      scores.set(file, (scores.get(file) ?? 0) + contribution);
    }
  }

  // Retain only file-kind entries (last segment must contain a period) and
  // sort by descending importance, then take the top CRITICAL_PATHS_MAX.
  const ranked = Array.from(scores.entries())
    .filter(([path]) => isFilePath(path))
    .sort((a, b) => b[1] - a[1])
    .slice(0, CRITICAL_PATHS_MAX)
    .map(([file]) => file);

  if (ranked.length === 0) return [];

  // Pre-build a lookup: which files are chain roots?
  const chainRootSet = new Set<string>(
    chains
      .map((c) => c[0])
      .filter((f): f is string => typeof f === 'string' && f.length > 0),
  );

  // Map each file to its immediate importer (if any) across all chains, for
  // constructing a more contextual rationale on non-root entries.
  const importerOf = new Map<string, string>();
  for (const chain of chains) {
    for (let i = 1; i < chain.length; i++) {
      const file = chain[i];
      const parent = chain[i - 1];
      if (file && parent && !importerOf.has(file)) {
        importerOf.set(file, parent);
      }
    }
  }

  return ranked.map((file) => ({
    file,
    rationale: buildRationale(file, chainRootSet, importerOf),
    link: buildLink(file),
  }));
}

/**
 * Produce a deterministic one-line rationale for a critical-path entry.
 *
 * Used on the degraded/skeleton path and as a fact hint in the LLM prompt.
 * The LLM may replace this text with richer prose on the happy path.
 */
function buildRationale(
  file: string,
  chainRootSet: Set<string>,
  importerOf: Map<string, string>,
): string {
  if (chainRootSet.has(file)) {
    return 'Entry point of a critical import chain in this codebase';
  }

  const importer = importerOf.get(file);
  if (importer) {
    const importerName = importer.split('/').pop() ?? importer;
    return `Core dependency imported by ${importerName}`;
  }

  return 'Frequently referenced file in the critical dependency graph';
}
