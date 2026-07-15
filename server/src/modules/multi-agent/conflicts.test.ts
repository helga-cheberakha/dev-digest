import { describe, it, expect } from 'vitest';
import { computeConflicts } from './conflicts.js';
import type { AgentColumn } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumn(
  agentId: string,
  agentName: string,
  findings: { file: string; start_line: number; severity: string; title: string }[],
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
      kind: 'finding',
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeConflicts', () => {
  it('returns empty array when given no columns', () => {
    expect(computeConflicts([])).toEqual([]);
  });

  it('returns empty array when no columns have any findings', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', []),
      makeColumn('agent-2', 'Agent Two', []),
    ];
    expect(computeConflicts(columns)).toEqual([]);
  });

  it('groups two agents flagging the same exact file:line into ONE Conflict', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'Possible null' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 10, severity: 'CRITICAL', title: 'Definite null' },
      ]),
    ];
    const conflicts = computeConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('src/foo.ts');
    expect(conflicts[0]!.line).toBe(10);
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('agent with no finding at that line gets verdict "ignored"', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'A bug' },
      ]),
      makeColumn('agent-2', 'Agent Two', []),
    ];
    const conflicts = computeConflicts(columns);
    expect(conflicts).toHaveLength(1);

    const takes = conflicts[0]!.takes;
    expect(takes).toHaveLength(2);

    const agent1Take = takes.find((t) => t.agent_id === 'agent-1');
    const agent2Take = takes.find((t) => t.agent_id === 'agent-2');
    expect(agent1Take?.verdict).toBe('WARNING');
    expect(agent2Take?.verdict).toBe('ignored');
  });

  it('preserves divergent severities across agents at the same file:line', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 20, severity: 'SUGGESTION', title: 'Minor issue' },
      ]),
      makeColumn('agent-2', 'Agent Two', [
        { file: 'src/foo.ts', start_line: 20, severity: 'CRITICAL', title: 'Critical issue' },
      ]),
      makeColumn('agent-3', 'Agent Three', [
        { file: 'src/foo.ts', start_line: 20, severity: 'WARNING', title: 'Warning issue' },
      ]),
    ];
    const conflicts = computeConflicts(columns);
    expect(conflicts).toHaveLength(1);

    const verdicts = conflicts[0]!.takes.map((t) => t.verdict);
    expect(verdicts).toContain('SUGGESTION');
    expect(verdicts).toContain('CRITICAL');
    expect(verdicts).toContain('WARNING');
  });

  it('does NOT group findings from different lines', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'Line 10' },
        { file: 'src/foo.ts', start_line: 20, severity: 'WARNING', title: 'Line 20' },
      ]),
    ];
    const conflicts = computeConflicts(columns);
    expect(conflicts).toHaveLength(2);
    const lines = conflicts.map((c) => c.line).sort();
    expect(lines).toEqual([10, 20]);
  });

  it('treats findings on different files as separate locations', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 10, severity: 'WARNING', title: 'foo' },
        { file: 'src/bar.ts', start_line: 10, severity: 'WARNING', title: 'bar' },
      ]),
    ];
    const conflicts = computeConflicts(columns);
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
    const conflicts = computeConflicts(columns);
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
    const conflicts = computeConflicts(columns);
    expect(conflicts[0]!.takes[0]!.note).toBe('My title');
  });

  it('note on an ignored take is empty string', () => {
    const columns = [
      makeColumn('agent-1', 'Agent One', [
        { file: 'src/foo.ts', start_line: 5, severity: 'WARNING', title: 'Found it' },
      ]),
      makeColumn('agent-2', 'Agent Two', []),
    ];
    const conflicts = computeConflicts(columns);
    const ignoredTake = conflicts[0]!.takes.find((t) => t.agent_id === 'agent-2');
    expect(ignoredTake?.note).toBe('');
  });
});
