/**
 * Architecture diagram builder.
 *
 * Converts a rank-ordered list of top files and their import edges into an
 * `OnboardingDiagram` (`{ nodes, edges }`).
 *
 * When the candidate node count exceeds `DIAGRAM_NODE_MAX`, the surplus is
 * deterministically collapsed into a single `kind:'overflow'` node (AC-11).
 * "Deterministic" means: topFiles is expected to arrive rank-ordered; the
 * first DIAGRAM_NODE_MAX entries are kept as `kind:'file'` nodes; all
 * remaining entries become one overflow node.
 *
 * Constraints:
 * - Pure function — no I/O. The caller (service, T10) passes in the
 *   rank-ordered file list and the import edges derived from the chains
 *   returned by `getCriticalPaths` or equivalent.
 * - Returns { nodes: [], edges: [] } when topFiles is empty (degraded /
 *   no-index skeleton case) — never throws.
 * - Edges are deduplicated and self-loops are removed.
 * - Overflow-bound edges (kept node → overflowed node) are redirected to
 *   the overflow node; overflow→overflow and overflowed→kept edges are
 *   similarly remapped so no dangling references remain.
 */

import type { OnboardingDiagram, OnboardingNode, OnboardingEdge } from '@devdigest/shared';

/**
 * Maximum number of regular (non-overflow) diagram nodes.
 * When topFiles.length > DIAGRAM_NODE_MAX, the surplus is collapsed into
 * one `kind:'overflow'` node so the diagram stays readable (AC-11).
 */
export const DIAGRAM_NODE_MAX = 8;

/** Stable synthetic ID for the overflow node. */
const OVERFLOW_NODE_ID = '__overflow__';

/**
 * Build the architecture diagram from rank-ordered files and import edges.
 *
 * @param topFiles  File paths ordered by descending rank (most important first).
 *                  Typically produced by `getTopFilesByRank`. An empty array
 *                  returns `{ nodes: [], edges: [] }`.
 * @param edges     Import edges as `{ from, to }` pairs, derived from the
 *                  dependency chains or the full import graph. Only edges whose
 *                  both endpoints are within `topFiles` (or remapped to the
 *                  overflow node) are included in the output.
 * @returns OnboardingDiagram with at most DIAGRAM_NODE_MAX regular nodes plus
 *          an optional overflow node.
 */
export function buildArchitectureDiagram(params: {
  topFiles: string[];
  edges: Array<{ from: string; to: string }>;
}): OnboardingDiagram {
  const { topFiles, edges } = params;

  if (topFiles.length === 0) {
    return { nodes: [], edges: [] };
  }

  const hasOverflow = topFiles.length > DIAGRAM_NODE_MAX;
  const keptFiles = hasOverflow ? topFiles.slice(0, DIAGRAM_NODE_MAX) : topFiles;
  const overflowFiles = hasOverflow ? topFiles.slice(DIAGRAM_NODE_MAX) : [];

  const keptSet = new Set<string>(keptFiles);
  const overflowSet = new Set<string>(overflowFiles);

  // --- Nodes -----------------------------------------------------------------

  const nodes: OnboardingNode[] = keptFiles.map((path) => ({
    id: path,
    label: path.split('/').pop() ?? path,
    kind: 'file' as const,
  }));

  if (hasOverflow) {
    nodes.push({
      id: OVERFLOW_NODE_ID,
      label: `+${overflowFiles.length} more files`,
      kind: 'overflow' as const,
    });
  }

  // --- Edges -----------------------------------------------------------------

  // Strategy:
  //   1. Skip edges where NEITHER endpoint is in topFiles (unrelated nodes).
  //   2. Remap overflow-set endpoints to the overflow node ID.
  //   3. Drop self-loops (can arise after remapping when both endpoints collapse).
  //   4. Deduplicate via a string key.
  const seenEdges = new Set<string>();
  const diagramEdges: OnboardingEdge[] = [];

  for (const edge of edges) {
    let from = edge.from;
    let to = edge.to;

    // Skip if neither endpoint is in our universe of known files.
    const fromKnown = keptSet.has(from) || overflowSet.has(from);
    const toKnown = keptSet.has(to) || overflowSet.has(to);
    if (!fromKnown || !toKnown) continue;

    // Remap overflowed endpoints to the overflow node.
    if (overflowSet.has(from)) from = OVERFLOW_NODE_ID;
    if (overflowSet.has(to)) to = OVERFLOW_NODE_ID;

    // Drop self-loops (both endpoints collapsed to overflow).
    if (from === to) continue;

    const key = `${from}→${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    diagramEdges.push({ from, to });
  }

  return { nodes, edges: diagramEdges };
}
