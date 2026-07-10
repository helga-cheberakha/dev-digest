/**
 * Unit tests for EvalAnalytics.
 *
 * No DB, no LLM — all I/O is intercepted via a minimal mock Container.
 * The Container is typed `as unknown as Container` so we only need to
 * provide the subset of methods the analytics module actually calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { EvalAnalytics } from './analytics.js';
import type { Container } from '../../platform/container.js';

// ---------------------------------------------------------------------------
// Mock-container factory
// ---------------------------------------------------------------------------

/** Minimal BatchRow shape as returned by batchesForOwner. */
function makeBatchRow(overrides: {
  batchId: string;
  ranAt?: Date;
  agentVersion?: number | null;
  recall?: number;
  precision?: number;
  citationAccuracy?: number;
  tracesPassed?: number;
  tracesTotal?: number;
}) {
  return {
    batchId: overrides.batchId,
    ranAt: overrides.ranAt ?? new Date('2024-01-01T00:00:00.000Z'),
    agentVersion: overrides.agentVersion ?? null,
    recall: overrides.recall ?? 0.8,
    precision: overrides.precision ?? 0.8,
    citationAccuracy: overrides.citationAccuracy ?? 0.8,
    tracesPassed: overrides.tracesPassed ?? 8,
    tracesTotal: overrides.tracesTotal ?? 10,
  };
}

/** Minimal run row as returned by runsForBatch. */
function makeRunRow(caseId: string, caseName: string, pass: boolean | null) {
  return { caseId, caseName, pass };
}

/** Minimal case row as returned by listCases. */
function makeCaseRow(
  id: string,
  name: string,
  expectation: 'must_find' | 'must_not_flag' = 'must_find',
) {
  return {
    id,
    name,
    workspaceId: 'ws',
    ownerKind: 'agent' as const,
    ownerId: 'agent-id',
    inputDiff: null,
    inputFiles: null,
    inputMeta: null,
    notes: null,
    expectedOutput: { expectation, regions: [] },
  };
}

type MockEvalRepo = {
  batchesForOwner: ReturnType<typeof vi.fn>;
  runsForBatch: ReturnType<typeof vi.fn>;
  listCases: ReturnType<typeof vi.fn>;
  recentRuns: ReturnType<typeof vi.fn>;
};

type MockAgentsRepo = {
  getVersion: ReturnType<typeof vi.fn>;
};

function makeContainer(
  evalRepo: Partial<MockEvalRepo> = {},
  agentsRepo: Partial<MockAgentsRepo> = {},
): Container {
  const repo: MockEvalRepo = {
    batchesForOwner: evalRepo.batchesForOwner ?? vi.fn().mockResolvedValue([]),
    runsForBatch: evalRepo.runsForBatch ?? vi.fn().mockResolvedValue([]),
    listCases: evalRepo.listCases ?? vi.fn().mockResolvedValue([]),
    recentRuns: evalRepo.recentRuns ?? vi.fn().mockResolvedValue([]),
  };
  const agents: MockAgentsRepo = {
    getVersion: agentsRepo.getVersion ?? vi.fn().mockResolvedValue(undefined),
  };
  return { evalRepo: repo, agentsRepo: agents } as unknown as Container;
}

// ---------------------------------------------------------------------------
// compare — delta calculation and prompt text
// ---------------------------------------------------------------------------

describe('EvalAnalytics.compare', () => {
  it('returns correct deltas (b − a) and exposes both prompt versions', async () => {
    const rowA = makeBatchRow({
      batchId: 'batch-a',
      ranAt: new Date('2024-01-01T00:00:00Z'),
      agentVersion: 1,
      recall: 0.6,
      precision: 0.7,
      citationAccuracy: 0.8,
    });
    const rowB = makeBatchRow({
      batchId: 'batch-b',
      ranAt: new Date('2024-01-02T00:00:00Z'),
      agentVersion: 2,
      recall: 0.8,
      precision: 0.65,
      citationAccuracy: 0.9,
    });

    const container = makeContainer(
      {
        batchesForOwner: vi.fn().mockResolvedValue([rowB, rowA]), // newest first
      },
      {
        getVersion: vi.fn().mockImplementation(async (_agentId: string, version: number) => ({
          configJson: {
            system_prompt: version === 1 ? 'System prompt v1' : 'System prompt v2',
          },
        })),
      },
    );

    const analytics = new EvalAnalytics(container);
    const result = await analytics.compare('ws', 'agent-id', 'batch-a', 'batch-b');

    expect(result.a.batch_id).toBe('batch-a');
    expect(result.b.batch_id).toBe('batch-b');

    // delta = b − a
    expect(result.delta.recall).toBeCloseTo(0.2, 10);
    expect(result.delta.precision).toBeCloseTo(-0.05, 10);
    expect(result.delta.citation_accuracy).toBeCloseTo(0.1, 10);

    // Both prompt versions must be present in prompt_diff
    expect((result.prompt_diff as { old: string; new: string }).old).toBe('System prompt v1');
    expect((result.prompt_diff as { old: string; new: string }).new).toBe('System prompt v2');
  });

  it('uses null for prompt when agent_version is null', async () => {
    const rowA = makeBatchRow({ batchId: 'b-a', agentVersion: null });
    const rowB = makeBatchRow({ batchId: 'b-b', agentVersion: null });

    const getVersion = vi.fn();
    const container = makeContainer(
      { batchesForOwner: vi.fn().mockResolvedValue([rowB, rowA]) },
      { getVersion },
    );

    const analytics = new EvalAnalytics(container);
    const result = await analytics.compare('ws', 'agent-id', 'b-a', 'b-b');

    // getVersion must not be called when agent_version is null
    expect(getVersion).not.toHaveBeenCalled();
    expect((result.prompt_diff as { old: null; new: null }).old).toBeNull();
    expect((result.prompt_diff as { old: null; new: null }).new).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveAlert via dashboard — floor-warning (7 cases, no flip)
// ---------------------------------------------------------------------------

describe('EvalAnalytics.dashboard — floor-warning', () => {
  it('returns floor-warning when owner has 7 cases and no pass-flip between last 2 batches', async () => {
    const caseIds = Array.from({ length: 7 }, (_, i) => `case-${i}`);
    const cases = caseIds.map((id, i) => makeCaseRow(id, `Case ${i}`, 'must_find'));

    const rowNewest = makeBatchRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') });
    const rowOlder = makeBatchRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') });

    // All cases pass in both batches — no flip
    const olderRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, true));
    const newerRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, true));

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([rowNewest, rowOlder]),
      runsForBatch: vi.fn().mockImplementation(async (_ws: string, _owner: string, batchId: string) =>
        batchId === 'b-newer' ? newerRuns : olderRuns,
      ),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    expect(dash.alert).toBe(
      'Only 7 eval cases — add more for reliable regression detection (recommended minimum: 8).',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAlert via dashboard — regression takes priority
// ---------------------------------------------------------------------------

describe('EvalAnalytics.dashboard — regression alert', () => {
  it('returns regression alert when a must_find case flips true→false, even with ≥8 cases (takes priority)', async () => {
    // 8 cases — floor condition would NOT fire (≥8). But regression fires.
    const caseIds = Array.from({ length: 8 }, (_, i) => `case-${i}`);
    const cases = caseIds.map((id, i) => makeCaseRow(id, `Case ${i}`, 'must_find'));

    const rowNewest = makeBatchRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') });
    const rowOlder = makeBatchRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') });

    // case-5 flips from pass=true to pass=false between older → newer
    const olderRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, true));
    const newerRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, id === 'case-5' ? false : true));

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([rowNewest, rowOlder]),
      runsForBatch: vi.fn().mockImplementation(async (_ws: string, _owner: string, batchId: string) =>
        batchId === 'b-newer' ? newerRuns : olderRuns,
      ),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    expect(dash.alert).toBe(
      "Regression: case 'Case 5' no longer finds the expected issue.",
    );
  });

  it('returns must_not_flag message when the regressed case has expectation=must_not_flag', async () => {
    const cases = [
      makeCaseRow('c1', 'False-positive guard', 'must_not_flag'),
      ...Array.from({ length: 7 }, (_, i) => makeCaseRow(`c${i + 2}`, `Case ${i + 2}`, 'must_find')),
    ];

    const rowNewest = makeBatchRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') });
    const rowOlder = makeBatchRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') });

    const olderRuns = cases.map((c) => makeRunRow(c.id, c.name, true));
    // c1 (the must_not_flag case) now fails — it started flagging something it shouldn't
    const newerRuns = cases.map((c) => makeRunRow(c.id, c.name, c.id === 'c1' ? false : true));

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([rowNewest, rowOlder]),
      runsForBatch: vi.fn().mockImplementation(async (_ws: string, _owner: string, batchId: string) =>
        batchId === 'b-newer' ? newerRuns : olderRuns,
      ),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    expect(dash.alert).toBe(
      "New false positive: case 'False-positive guard' now flags a finding it previously didn't.",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAlert via dashboard — alphabetical tie-breaking
// ---------------------------------------------------------------------------

describe('EvalAnalytics.dashboard — tie-breaking (alphabetical-first case)', () => {
  it('when two cases flip in the same batch pair, picks the alphabetically-first case name', async () => {
    // Two cases flip: "Zebra Case" and "Alpha Case"
    // Expected: "Alpha Case" is chosen (comes first alphabetically)
    const c1 = makeCaseRow('c-z', 'Zebra Case', 'must_find');
    const c2 = makeCaseRow('c-a', 'Alpha Case', 'must_not_flag');
    // Add more cases to meet 8-case minimum so floor warning doesn't interfere
    const extra = Array.from({ length: 6 }, (_, i) =>
      makeCaseRow(`c-extra-${i}`, `Extra Case ${i}`, 'must_find'),
    );
    const cases = [c1, c2, ...extra];

    const rowNewest = makeBatchRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') });
    const rowOlder = makeBatchRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') });

    const olderRuns = cases.map((c) => makeRunRow(c.id, c.name, true));
    // Both c-z and c-a flip to false
    const newerRuns = cases.map((c) =>
      makeRunRow(c.id, c.name, c.id === 'c-z' || c.id === 'c-a' ? false : true),
    );

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([rowNewest, rowOlder]),
      runsForBatch: vi.fn().mockImplementation(async (_ws: string, _owner: string, batchId: string) =>
        batchId === 'b-newer' ? newerRuns : olderRuns,
      ),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    // "Alpha Case" < "Zebra Case" alphabetically; and it's must_not_flag
    expect(dash.alert).toBe(
      "New false positive: case 'Alpha Case' now flags a finding it previously didn't.",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAlert via dashboard — single batch (no comparison possible)
// ---------------------------------------------------------------------------

describe('EvalAnalytics.dashboard — single batch', () => {
  it('returns null alert when owner has only one batch and ≥8 cases', async () => {
    const cases = Array.from({ length: 8 }, (_, i) => makeCaseRow(`c-${i}`, `Case ${i}`));
    const singleBatch = makeBatchRow({ batchId: 'b-only' });

    // Only one batch — no comparison possible
    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([singleBatch]),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    // Fewer than 2 batches → step a/b skipped; 8 cases → step c doesn't fire
    expect(dash.alert).toBeNull();
  });

  it('returns null alert when owner has zero batches and ≥8 cases', async () => {
    const cases = Array.from({ length: 8 }, (_, i) => makeCaseRow(`c-${i}`, `Case ${i}`));

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([]),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    expect(dash.alert).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// history — mapping
// ---------------------------------------------------------------------------

describe('EvalAnalytics.history', () => {
  it('maps DB rows to EvalRunBatch DTOs in newest-first order', async () => {
    const row1 = makeBatchRow({
      batchId: 'b1',
      ranAt: new Date('2024-01-02T12:00:00Z'),
      agentVersion: 3,
      recall: 0.9,
      precision: 0.85,
      citationAccuracy: 0.95,
      tracesPassed: 9,
      tracesTotal: 10,
    });
    const row2 = makeBatchRow({
      batchId: 'b2',
      ranAt: new Date('2024-01-01T12:00:00Z'),
      agentVersion: 2,
      recall: 0.7,
      precision: 0.75,
      citationAccuracy: 0.8,
      tracesPassed: 7,
      tracesTotal: 10,
    });

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([row1, row2]),
    });

    const analytics = new EvalAnalytics(container);
    const result = await analytics.history('ws', 'agent-id');

    expect(result).toHaveLength(2);
    expect(result[0]!.batch_id).toBe('b1');
    expect(result[0]!.agent_version).toBe(3);
    expect(result[0]!.recall).toBe(0.9);
    expect(result[0]!.ran_at).toBe('2024-01-02T12:00:00.000Z');
    expect(result[1]!.batch_id).toBe('b2');
  });
});

// ---------------------------------------------------------------------------
// dashboard — shape checks
// ---------------------------------------------------------------------------

describe('EvalAnalytics.dashboard — shape', () => {
  it('agent dashboard: sets owner_kind="agent", owner_id, and empty recent_runs', async () => {
    const batch = makeBatchRow({ batchId: 'b', recall: 0.9, precision: 0.9, citationAccuracy: 0.9 });
    const cases = Array.from({ length: 10 }, (_, i) => makeCaseRow(`c-${i}`, `Case ${i}`));

    const container = makeContainer({
      batchesForOwner: vi.fn().mockResolvedValue([batch]),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'my-agent');

    expect(dash.owner_kind).toBe('agent');
    expect(dash.owner_id).toBe('my-agent');
    expect(dash.recent_runs).toEqual([]);
    expect(dash.cases_total).toBe(10);
  });

  it('agent dashboard: trend is chronological (oldest first)', async () => {
    const older = makeBatchRow({ batchId: 'b-old', ranAt: new Date('2024-01-01T00:00:00Z') });
    const newer = makeBatchRow({ batchId: 'b-new', ranAt: new Date('2024-02-01T00:00:00Z') });

    const container = makeContainer({
      // batchesForOwner returns newest-first
      batchesForOwner: vi.fn().mockResolvedValue([newer, older]),
      listCases: vi.fn().mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => makeCaseRow(`c-${i}`, `Case ${i}`)),
      ),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'a');

    // trend must be oldest-first
    expect(dash.trend[0]!.ran_at).toBe('2024-01-01T00:00:00.000Z');
    expect(dash.trend[1]!.ran_at).toBe('2024-02-01T00:00:00.000Z');
  });

  it('workspace dashboard: owner_kind=null, owner_id=null, alert=null, has recent_runs', async () => {
    const container = makeContainer({
      recentRuns: vi.fn().mockResolvedValue([
        {
          id: 'run-1',
          caseId: 'c-1',
          caseName: 'Test case',
          ranAt: new Date('2024-01-01T00:00:00Z'),
          pass: true,
          recall: 0.9,
          precision: 0.85,
          citationAccuracy: 0.9,
          batchId: 'b1',
          agentVersion: 1,
        },
      ]),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', null);

    expect(dash.owner_kind).toBeNull();
    expect(dash.owner_id).toBeNull();
    expect(dash.alert).toBeNull();
    expect(dash.recent_runs).toHaveLength(1);
    expect(dash.recent_runs[0]!.case_id).toBe('c-1');
  });
});
