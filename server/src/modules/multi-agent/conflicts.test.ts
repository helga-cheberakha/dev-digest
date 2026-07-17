import { describe, it, expect } from 'vitest';
import { buildConflicts, rangesOverlap } from './conflicts.js';
import type { AgentColumn } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumn(
  agentId: string,
  agentName: string,
  findings: {
    file: string;
    start_line: number;
    end_line?: number;
    severity: string;
    title: string;
  }[],
): AgentColumn {
  return {
    run_id: `run-${agentId}`,
    agent_id: agentId,
    agent_name: agentName,
    provider: null,
    model: null,
    status: 'done',
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: findings.map((f, i) => ({
      id: `finding-${agentId}-${i}`,
      severity: f.severity as AgentColumn['findings'][number]['severity'],
      category: 'security',
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line ?? f.start_line,
      kind: 'finding',
    })),
  };
}

// ---------------------------------------------------------------------------
// rangesOverlap
// ---------------------------------------------------------------------------

describe('rangesOverlap', () => {
  it('is true for identical single-line ranges', () => {
    expect(rangesOverlap({ start_line: 10, end_line: 10 }, { start_line: 10, end_line: 10 })).toBe(true);
  });

  it('is true when ranges partially overlap', () => {
    expect(rangesOverlap({ start_line: 8, end_line: 12 }, { start_line: 10, end_line: 15 })).toBe(true);
  });

  it('is true when one range is nested inside the other', () => {
    expect(rangesOverlap({ start_line: 5, end_line: 20 }, { start_line: 10, end_line: 12 })).toBe(true);
  });

  it('is true when ranges touch at a shared boundary line', () => {
    expect(rangesOverlap({ start_line: 5, end_line: 10 }, { start_line: 10, end_line: 15 })).toBe(true);
  });

  it('is false when ranges are disjoint', () => {
    expect(rangesOverlap({ start_line: 5, end_line: 8 }, { start_line: 20, end_line: 25 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildConflicts
// ---------------------------------------------------------------------------

describe('buildConflicts', () => {
  it('returns empty array when given no columns', () => {
    expect(buildConflicts([])).toEqual([]);
  });

  it('returns empty array when no columns have any findings', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', []),
      makeColumn('agent-2', 'Agent Two', []),
    ];
    expect(buildConflicts(columns)).toEqual([]);
  });

  it('groups two agents flagging the same exact file:line with similar titles into ONE Conflict', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'Possible null dereference' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 10, severity: 'CRITICAL', title: 'Definite null dereference' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('src/foo.ts');
    expect(conflicts[0]!.line).toBe(10);
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('groups overlapping-but-different line ranges with similar titles into ONE Conflict', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, end_line: 10, severity: 'WARNING', title: 'SQL injection risk' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        {
          file: 'src/foo.ts',
          start_line: 9,
          end_line: 12,
          severity: 'CRITICAL',
          title: 'Possible SQL injection',
        },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('does NOT group overlapping ranges when titles describe unrelated issues', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, end_line: 12, severity: 'WARNING', title: 'SQL injection risk' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 11, end_line: 11, severity: 'SUGGESTION', title: 'Missing test coverage' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(2);
  });

  it('does NOT group same-titled findings on non-overlapping lines', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'Null check missing' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 40, severity: 'WARNING', title: 'Null check missing' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(2);
  });

  it('agent with no finding at that location gets verdict "ignored"', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'A bug' },
      ]),
      makeColumn('agent-2', 'Agent Two', []),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);

    const takes = conflicts[0]!.takes;
    expect(takes).toHaveLength(2);

    const agent1Take = takes.find((t) => t.agent_id === 'agent-1');
    const agent2Take = takes.find((t) => t.agent_id === 'agent-2');
    expect(agent1Take?.verdict).toBe('WARNING');
    expect(agent2Take?.verdict).toBe('ignored');
  });

  it('preserves divergent severities across agents at the same location', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 20, severity: 'SUGGESTION', title: 'Minor race condition' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 20, severity: 'CRITICAL', title: 'Critical race condition' },
      ]),
      makeColumn('agent-3', 'Agent Three', [
        { file: 'src/foo.ts', start_line: 20, severity: 'WARNING', title: 'Race condition warning' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);

    const verdicts = conflicts[0]!.takes.map((t) => t.verdict);
    expect(verdicts).toContain('SUGGESTION');
    expect(verdicts).toContain('CRITICAL');
    expect(verdicts).toContain('WARNING');
  });

  it('does NOT group findings from different, non-overlapping lines', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'Unused import' },
        { file: 'src/foo.ts', start_line: 20, severity: 'WARNING', title: 'Unused variable' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(2);
    const lines = conflicts.map((c) => c.line).sort();
    expect(lines).toEqual([10, 20]);
  });

  it('treats findings on different files as separate locations even with the same title', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'Null check missing' },
        { file: 'src/bar.ts', start_line: 10, severity: 'WARNING', title: 'Null check missing' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(2);
    const files = conflicts.map((c) => c.file).sort();
    expect(files).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('single agent with one finding produces a Conflict with one non-ignored take', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 5, severity: 'CRITICAL', title: 'Bug' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(1);
    expect(conflicts[0]!.takes[0]!.verdict).toBe('CRITICAL');
    expect(conflicts[0]!.takes[0]!.persona).toBe('Agent One');
  });

  it('note on a flagged take is the finding title', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 5, severity: 'WARNING', title: 'My title' },
      ]),
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts[0]!.takes[0]!.note).toBe('My title');
  });

  it('excludes a failed agent from takes entirely (never reviewed, not "ignored")', () => {
    const columns: AgentColumn[] = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 5, severity: 'WARNING', title: 'Found it' },
      ]),
      { ...makeColumn('agent-2', 'Agent Two', []), status: 'failed' },
    ];
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(1);
    expect(conflicts[0]!.takes.some((t) => t.agent_id === 'agent-2')).toBe(false);
  });

  it('returns empty array when the only column failed', () => {
    const columns: AgentColumn[] = [
      { ...makeColumn('agent-1', 'Agent One', []), status: 'failed' },
    ];
    expect(buildConflicts(columns)).toEqual([]);
  });

  it('note on an ignored take is empty string', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 5, severity: 'WARNING', title: 'Found it' },
      ]),
      makeColumn('agent-2', 'Agent Two', []),
    ];
    const conflicts = buildConflicts(columns);
    const ignoredTake = conflicts[0]!.takes.find((t) => t.agent_id === 'agent-2');
    expect(ignoredTake?.note).toBe('');
  });

  it('transitively clusters a chain of overlapping, similarly-titled findings into one Conflict', () => {
    // agent-1's range does not directly overlap agent-3's range — they only
    // chain together via agent-2, which overlaps both. Titles are pairwise
    // similar throughout, so the whole chain should collapse into one Conflict.
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, end_line: 12, severity: 'WARNING', title: 'user input validation missing' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 12, end_line: 14, severity: 'CRITICAL', title: 'input validation not enforced' },
      ]),
      makeColumn('agent-3', 'Agent Three', [
        { file: 'src/foo.ts', start_line: 14, end_line: 16, severity: 'WARNING', title: 'missing input validation check' },
      ]),
    ];
    expect(rangesOverlap({ start_line: 10, end_line: 12 }, { start_line: 14, end_line: 16 })).toBe(false);
    const conflicts = buildConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(3);
  });
});
