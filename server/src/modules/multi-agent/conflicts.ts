import type { AgentColumn, Conflict, ConflictTake } from '@devdigest/shared';

/**
 * Pure helper — no DB access, no I/O.
 *
 * Group a multi-agent run's findings by exact `file + ':' + start_line`.
 * For each location with ≥1 finding across any column, emit a Conflict whose
 * `takes` array includes every column that actually reviewed (status !== 'failed'):
 *   - if the agent flagged that exact line: verdict = their Severity
 *   - if they did not flag it:              verdict = 'ignored'
 * Failed columns are excluded entirely — they never reviewed anything, so they
 * must not appear as "did not flag".
 *
 * Deterministic. Exact-line match only — no range/fuzzy matching across
 * adjacent lines (explicitly decided against during design).
 */
export function computeConflicts(columns: AgentColumn[]): Conflict[] {
  // A failed agent never reviewed anything — exclude it so it doesn't show up
  // as "did not flag" (that verdict is reserved for agents that completed and
  // genuinely found nothing, per AC-16).
  const reviewedColumns = columns.filter((column) => column.status !== 'failed');
  if (reviewedColumns.length === 0) return [];

  // Step 1: collect all (file, line) locations that have at least one finding.
  // The first finding seen at a location supplies the shared `title`.
  const locationMap = new Map<string, { file: string; line: number; title: string }>();
  for (const column of reviewedColumns) {
    for (const finding of column.findings) {
      const key = `${finding.file}:${finding.start_line}`;
      if (!locationMap.has(key)) {
        locationMap.set(key, {
          file: finding.file,
          line: finding.start_line,
          title: finding.title,
        });
      }
    }
  }

  if (locationMap.size === 0) return [];

  // Step 2: for each location, build one Conflict with a take from every agent.
  const conflicts: Conflict[] = [];
  for (const [, { file, line, title }] of locationMap) {
    const takes: ConflictTake[] = reviewedColumns.map((column) => {
      const matching = column.findings.find(
        (f) => f.file === file && f.start_line === line,
      );
      if (matching) {
        return {
          agent_id: column.agent_id,
          persona: column.agent_name,
          verdict: matching.severity,
          note: matching.title,
        };
      }
      return {
        agent_id: column.agent_id,
        persona: column.agent_name,
        verdict: 'ignored' as const,
        note: '',
      };
    });
    conflicts.push({ file, line, title, takes });
  }

  return conflicts;
}
