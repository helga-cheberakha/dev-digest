import type { AgentColumn, Conflict, ConflictTake } from '@devdigest/shared';

/**
 * Pure helper — no DB access, no I/O.
 *
 * Group a multi-agent run's findings by exact `file + ':' + start_line`.
 * For each location with ≥1 finding across any column, emit a Conflict whose
 * `takes` array includes EVERY agent column in the run:
 *   - if the agent flagged that exact line: verdict = their Severity
 *   - if they did not flag it:              verdict = 'ignored'
 *
 * Deterministic. Exact-line match only — no range/fuzzy matching across
 * adjacent lines (explicitly decided against during design).
 */
export function computeConflicts(columns: AgentColumn[]): Conflict[] {
  if (columns.length === 0) return [];

  // Step 1: collect all (file, line) locations that have at least one finding.
  // The first finding seen at a location supplies the shared `title`.
  const locationMap = new Map<string, { file: string; line: number; title: string }>();
  for (const column of columns) {
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
    const takes: ConflictTake[] = columns.map((column) => {
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
