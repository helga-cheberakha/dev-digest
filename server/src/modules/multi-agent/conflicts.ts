import type { AgentColumn, AgentColumnFinding, Conflict, ConflictTake } from '@devdigest/shared';

/**
 * Pure helper — no DB access, no I/O.
 *
 * Two findings are the "same location" (and therefore folded into one
 * Conflict) when they share a file, their line ranges overlap, and their
 * titles describe similar substance. This intentionally groups near-miss
 * findings from different agents (e.g. one flags line 10, another flags
 * lines 9-11, both about the same null check) instead of requiring an exact
 * `start_line` match.
 */
export function rangesOverlap(
  a: { start_line: number; end_line: number },
  b: { start_line: number; end_line: number },
): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'to', 'in',
  'on', 'at', 'and', 'or', 'not', 'this', 'that', 'it', 'its', 'with', 'for',
]);

/** Lowercase, punctuation-stripped, stopword-filtered word set of a title. */
function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 0 && !STOPWORDS.has(word)),
  );
}

/** Below this Jaccard similarity of title tokens, two findings are treated as unrelated. */
const TITLE_SIMILARITY_THRESHOLD = 0.3;

/** Deterministic, LLM-free "same substance" check — Jaccard similarity over title tokens. */
function titlesAreSimilar(a: string, b: string): boolean {
  const tokensA = titleTokens(a);
  const tokensB = titleTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  const union = tokensA.size + tokensB.size - shared;
  return union > 0 && shared / union >= TITLE_SIMILARITY_THRESHOLD;
}

/** Union-Find over finding indices, used to cluster same-location findings transitively. */
class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]!);
    return this.parent[i]!;
  }
  union(i: number, j: number): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) this.parent[rootI] = rootJ;
  }
}

type Entry = { column: AgentColumn; finding: AgentColumnFinding };

/**
 * Group a multi-agent run's findings into Conflicts by clustering findings
 * that share a file, overlap in line range, and describe similar substance
 * (see `rangesOverlap` / title-similarity above) — not just an exact
 * `file:start_line` match.
 *
 * For each cluster, emit a Conflict whose `takes` array includes every
 * column that actually reviewed (status !== 'failed'):
 *   - if the agent has a finding in the cluster: verdict = its Severity
 *   - if it does not:                            verdict = 'ignored'
 * Failed columns are excluded entirely — they never reviewed anything, so
 * they must not appear as "did not flag".
 *
 * Deterministic — no LLM calls.
 */
export function buildConflicts(columns: AgentColumn[]): Conflict[] {
  // A failed agent never reviewed anything — exclude it so it doesn't show up
  // as "did not flag" (that verdict is reserved for agents that completed and
  // genuinely found nothing, per AC-16).
  const reviewedColumns = columns.filter((column) => column.status !== 'failed');
  if (reviewedColumns.length === 0) return [];

  // Flatten to one entry per (column, finding) pair, preserving column then
  // per-column finding order — this order supplies the "first seen" title
  // used as each cluster's representative.
  const entries: Entry[] = [];
  for (const column of reviewedColumns) {
    for (const finding of column.findings) {
      entries.push({ column, finding });
    }
  }
  if (entries.length === 0) return [];

  // Union any two findings that share a file, overlap in range, and have
  // similar-enough titles — transitively, so a chain of near-miss findings
  // clusters into one location.
  const clusters = new UnionFind(entries.length);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!.finding;
      const b = entries[j]!.finding;
      if (a.file === b.file && rangesOverlap(a, b) && titlesAreSimilar(a.title, b.title)) {
        clusters.union(i, j);
      }
    }
  }

  // Group entry indices by cluster root, in first-seen order.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = clusters.find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }

  const conflicts: Conflict[] = [];
  for (const indices of groups.values()) {
    const representative = entries[indices[0]!]!.finding;

    const takes: ConflictTake[] = reviewedColumns.map((column) => {
      const memberIndex = indices.find((i) => entries[i]!.column.agent_id === column.agent_id);
      if (memberIndex !== undefined) {
        const finding = entries[memberIndex]!.finding;
        return {
          agent_id: column.agent_id,
          persona: column.agent_name,
          verdict: finding.severity,
          note: finding.title,
        };
      }
      return {
        agent_id: column.agent_id,
        persona: column.agent_name,
        verdict: 'ignored' as const,
        note: '',
      };
    });

    conflicts.push({
      file: representative.file,
      line: representative.start_line,
      title: representative.title,
      takes,
    });
  }

  return conflicts;
}
