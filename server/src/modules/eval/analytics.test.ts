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

/**
 * A per-run row as returned by the new `batchRunsWithExpectedForOwner` method.
 * Each batch can have multiple rows (one per eval_runs row).
 *
 * The analytics layer groups these by batchId and computes TRUE pooled metrics
 * via scoring.scoreCase + scoring.aggregate.
 */
function makeAggRunRow(overrides: {
  batchId: string;
  ranAt?: Date;
  agentVersion?: number | null;
  pass?: boolean | null;
  caseName?: string;
  findings?: Array<{
    id: string;
    severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
    category: 'bug' | 'security' | 'perf' | 'style' | 'test';
    title: string;
    file: string;
    start_line: number;
    end_line: number;
  }>;
  grounding?: { kept: number; produced: number };
  expectation?: 'must_find' | 'must_not_flag';
  expectedRegions?: Array<{ file: string; start_line: number; end_line: number }>;
}) {
  return {
    batchId: overrides.batchId,
    ranAt: overrides.ranAt ?? new Date('2024-01-01T00:00:00.000Z'),
    agentVersion: overrides.agentVersion ?? null,
    pass: overrides.pass ?? true,
    caseName: overrides.caseName ?? 'Test Case',
    actualOutput: {
      findings: overrides.findings ?? [],
      grounding: overrides.grounding ?? { kept: 0, produced: 0 },
    },
    expectedOutput: {
      expectation: overrides.expectation ?? 'must_find',
      regions: overrides.expectedRegions ?? [],
    },
  };
}

/** Minimal run row as returned by runsForBatch (unchanged from before). */
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
  batchRunsWithExpectedForOwner: ReturnType<typeof vi.fn>;
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
    batchRunsWithExpectedForOwner:
      evalRepo.batchRunsWithExpectedForOwner ?? vi.fn().mockResolvedValue([]),
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
// Helpers for fixture region/finding construction
// ---------------------------------------------------------------------------

/** A region covering a single line in file 'f'. */
const region = (line: number) => ({ file: 'f', start_line: line, end_line: line });

/** A FindingLite covering a single line in file 'f'. */
const finding = (line: number) => ({
  id: `finding-${line}`,
  severity: 'WARNING' as const,
  category: 'bug' as const,
  title: 'Test finding',
  file: 'f',
  start_line: line,
  end_line: line,
});

// ---------------------------------------------------------------------------
// compare — delta calculation and prompt text
// ---------------------------------------------------------------------------

describe('EvalAnalytics.compare', () => {
  it('returns correct deltas (b − a) and exposes both prompt versions', async () => {
    // BatchA: 2 expected regions, 1 matched → recall=0.5; grounding kept=2, produced=4 → citation=0.5
    const rowA = makeAggRunRow({
      batchId: 'batch-a',
      ranAt: new Date('2024-01-01T00:00:00Z'),
      agentVersion: 1,
      pass: true,
      findings: [finding(1)],              // 1 actual matching region(1)
      grounding: { kept: 2, produced: 4 }, // citation = 2/4 = 0.5
      expectation: 'must_find',
      expectedRegions: [region(1), region(2)], // 2 expected; 1 matched
    });

    // BatchB: 5 expected regions, 4 matched → recall=0.8; grounding kept=4, produced=5 → citation=0.8
    const rowB = makeAggRunRow({
      batchId: 'batch-b',
      ranAt: new Date('2024-01-02T00:00:00Z'),
      agentVersion: 2,
      pass: true,
      findings: [finding(1), finding(2), finding(3), finding(4)], // 4 actuals
      grounding: { kept: 4, produced: 5 },                        // citation = 4/5 = 0.8
      expectation: 'must_find',
      expectedRegions: [region(1), region(2), region(3), region(4), region(5)], // 5 expected; 4 matched
    });

    const container = makeContainer(
      {
        batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([rowA, rowB]), // oldest first
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

    // batchA: recall=0.5, citation=0.5; batchB: recall=0.8, citation=0.8
    // delta = b − a
    expect(result.delta.recall).toBeCloseTo(0.3, 10);
    expect(result.delta.precision).toBeCloseTo(0.0, 10);    // both precision=1.0 (all actuals match)
    expect(result.delta.citation_accuracy).toBeCloseTo(0.3, 10);

    // Both prompt versions must be present in prompt_diff
    expect((result.prompt_diff as { old: string; new: string }).old).toBe('System prompt v1');
    expect((result.prompt_diff as { old: string; new: string }).new).toBe('System prompt v2');
  });

  it('uses null for prompt when agent_version is null', async () => {
    const rowA = makeAggRunRow({ batchId: 'b-a', agentVersion: null });
    const rowB = makeAggRunRow({ batchId: 'b-b', agentVersion: null });

    const getVersion = vi.fn();
    const container = makeContainer(
      { batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([rowA, rowB]) },
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

    // Two batches (newest-first by ranAt)
    const rowsNewer = [
      makeAggRunRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') }),
    ];
    const rowsOlder = [
      makeAggRunRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') }),
    ];

    // All cases pass in both batches — no flip
    const olderRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, true));
    const newerRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, true));

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi
        .fn()
        .mockResolvedValue([...rowsOlder, ...rowsNewer]),
      runsForBatch: vi
        .fn()
        .mockImplementation(
          async (_ws: string, _owner: string, batchId: string) =>
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

    const rowsNewer = [
      makeAggRunRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') }),
    ];
    const rowsOlder = [
      makeAggRunRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') }),
    ];

    // case-5 flips from pass=true to pass=false between older → newer
    const olderRuns = caseIds.map((id, i) => makeRunRow(id, `Case ${i}`, true));
    const newerRuns = caseIds.map((id, i) =>
      makeRunRow(id, `Case ${i}`, id === 'case-5' ? false : true),
    );

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi
        .fn()
        .mockResolvedValue([...rowsOlder, ...rowsNewer]),
      runsForBatch: vi
        .fn()
        .mockImplementation(
          async (_ws: string, _owner: string, batchId: string) =>
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

    const rowsNewer = [
      makeAggRunRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') }),
    ];
    const rowsOlder = [
      makeAggRunRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') }),
    ];

    const olderRuns = cases.map((c) => makeRunRow(c.id, c.name, true));
    // c1 (the must_not_flag case) now fails — it started flagging something it shouldn't
    const newerRuns = cases.map((c) => makeRunRow(c.id, c.name, c.id === 'c1' ? false : true));

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi
        .fn()
        .mockResolvedValue([...rowsOlder, ...rowsNewer]),
      runsForBatch: vi
        .fn()
        .mockImplementation(
          async (_ws: string, _owner: string, batchId: string) =>
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

    const rowsNewer = [
      makeAggRunRow({ batchId: 'b-newer', ranAt: new Date('2024-02-01T00:00:00Z') }),
    ];
    const rowsOlder = [
      makeAggRunRow({ batchId: 'b-older', ranAt: new Date('2024-01-01T00:00:00Z') }),
    ];

    const olderRuns = cases.map((c) => makeRunRow(c.id, c.name, true));
    // Both c-z and c-a flip to false
    const newerRuns = cases.map((c) =>
      makeRunRow(c.id, c.name, c.id === 'c-z' || c.id === 'c-a' ? false : true),
    );

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi
        .fn()
        .mockResolvedValue([...rowsOlder, ...rowsNewer]),
      runsForBatch: vi
        .fn()
        .mockImplementation(
          async (_ws: string, _owner: string, batchId: string) =>
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
    // Only one batch
    const singleBatchRows = [makeAggRunRow({ batchId: 'b-only' })];

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue(singleBatchRows),
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
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([]),
      listCases: vi.fn().mockResolvedValue(cases),
    });

    const analytics = new EvalAnalytics(container);
    const dash = await analytics.dashboard('ws', 'agent-id');

    expect(dash.alert).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// history — mapping and pooled aggregation
// ---------------------------------------------------------------------------

describe('EvalAnalytics.history', () => {
  it('maps per-run rows to EvalRunBatch DTOs in newest-first order', async () => {
    // batch b1 (newer): 1 run, 10 expected, 9 matched → recall = 9/10 = 0.9
    const b1Rows = [
      makeAggRunRow({
        batchId: 'b1',
        ranAt: new Date('2024-01-02T12:00:00Z'),
        agentVersion: 3,
        pass: true,
        findings: Array.from({ length: 9 }, (_, i) => finding(i + 1)), // lines 1-9
        grounding: { kept: 9, produced: 9 },
        expectation: 'must_find',
        expectedRegions: Array.from({ length: 10 }, (_, i) => region(i + 1)), // lines 1-10
      }),
    ];

    // batch b2 (older): 1 empty run → recall=1 (vacuously, 0 expected), citation=1
    const b2Rows = [
      makeAggRunRow({
        batchId: 'b2',
        ranAt: new Date('2024-01-01T12:00:00Z'),
        agentVersion: 2,
        pass: true,
      }),
    ];

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([...b2Rows, ...b1Rows]),
    });

    const analytics = new EvalAnalytics(container);
    const result = await analytics.history('ws', 'agent-id');

    expect(result).toHaveLength(2);

    // b1 must be first (newest by ranAt)
    expect(result[0]!.batch_id).toBe('b1');
    expect(result[0]!.agent_version).toBe(3);
    expect(result[0]!.recall).toBeCloseTo(0.9, 10);
    expect(result[0]!.ran_at).toBe('2024-01-02T12:00:00.000Z');

    expect(result[1]!.batch_id).toBe('b2');
  });

  it('pooled aggregation: recall differs from macro-average when cases have different numbers of expected regions', async () => {
    // Two cases in one batch that would give different pooled vs macro-average:
    //   Case 1: 3 expected, all 3 matched  → per-case recall = 3/3 = 1.0
    //   Case 2: 1 expected, 0 matched      → per-case recall = 0/1 = 0.0
    //
    //   Pooled  recall = (3+0) / (3+1) = 3/4 = 0.75
    //   Macro   recall = (1.0 + 0.0) / 2  = 0.5
    //
    // The test would FAIL under the old SQL avg() formula (would produce 0.5).

    const run1 = makeAggRunRow({
      batchId: 'pooled-test',
      ranAt: new Date('2024-01-01T00:00:00Z'),
      agentVersion: 1,
      pass: true,
      caseName: 'Case 1 — 3 of 3 matched',
      findings: [finding(1), finding(2), finding(3)], // match all 3 expected
      grounding: { kept: 3, produced: 3 },
      expectation: 'must_find',
      expectedRegions: [region(1), region(2), region(3)],
    });

    const run2 = makeAggRunRow({
      batchId: 'pooled-test',
      ranAt: new Date('2024-01-01T00:00:01Z'),
      agentVersion: 1,
      pass: false,
      caseName: 'Case 2 — 0 of 1 matched',
      findings: [],               // no actuals → misses the expected region
      grounding: { kept: 0, produced: 0 },
      expectation: 'must_find',
      expectedRegions: [region(10)], // different file line (won't intersect findings)
    });

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([run1, run2]),
      listCases: vi.fn().mockResolvedValue([]),
    });

    const analytics = new EvalAnalytics(container);
    const result = await analytics.history('ws', 'agent-id');

    expect(result).toHaveLength(1);
    const batch = result[0]!;

    // Pooled recall = 3/4 = 0.75
    expect(batch.recall).toBeCloseTo(0.75, 10);

    // Explicitly verify this differs from the macro-average (0.5)
    const macroAvgRecall = (1.0 + 0.0) / 2;
    expect(batch.recall).not.toBeCloseTo(macroAvgRecall, 5);

    // Traces: both runs counted
    expect(batch.traces_total).toBe(2);
    expect(batch.traces_passed).toBe(1); // only run1 passed
  });

  it('errored runs (pass=null) are counted in traces_total but excluded from pooled metrics', async () => {
    // 1 successful run: 2 expected, 2 matched → recall=1.0
    const successRun = makeAggRunRow({
      batchId: 'b-err',
      ranAt: new Date('2024-01-01T00:00:00Z'),
      agentVersion: 1,
      pass: true,
      findings: [finding(1), finding(2)],
      grounding: { kept: 2, produced: 2 },
      expectation: 'must_find',
      expectedRegions: [region(1), region(2)],
    });

    // 1 errored run: pass=null; stores empty findings / error field
    const errorRun = {
      batchId: 'b-err',
      ranAt: new Date('2024-01-01T00:00:01Z'),
      agentVersion: 1,
      pass: null,
      caseName: 'Errored Case',
      actualOutput: { findings: [], grounding: { kept: 0, produced: 0 }, error: 'LLM timeout' },
      expectedOutput: { expectation: 'must_find', regions: [region(99)] },
    };

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([successRun, errorRun]),
      listCases: vi.fn().mockResolvedValue([]),
    });

    const analytics = new EvalAnalytics(container);
    const result = await analytics.history('ws', 'agent-id');

    const batch = result[0]!;

    // traces_total includes both the successful run and the errored run
    expect(batch.traces_total).toBe(2);
    // traces_passed counts only pass=true
    expect(batch.traces_passed).toBe(1);

    // Pooled metrics derived from the successful run ONLY (errored run excluded):
    // recall = 2/2 = 1.0 (not affected by the errored run's expected region)
    expect(batch.recall).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// dashboard — shape checks
// ---------------------------------------------------------------------------

describe('EvalAnalytics.dashboard — shape', () => {
  it('agent dashboard: sets owner_kind="agent", owner_id, and empty recent_runs', async () => {
    const batchRows = [
      makeAggRunRow({ batchId: 'b', pass: true }),
    ];
    const cases = Array.from({ length: 10 }, (_, i) => makeCaseRow(`c-${i}`, `Case ${i}`));

    const container = makeContainer({
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue(batchRows),
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
    const olderRow = makeAggRunRow({
      batchId: 'b-old',
      ranAt: new Date('2024-01-01T00:00:00Z'),
      pass: true,
    });
    const newerRow = makeAggRunRow({
      batchId: 'b-new',
      ranAt: new Date('2024-02-01T00:00:00Z'),
      pass: true,
    });

    const container = makeContainer({
      // Provide older row first — history should sort newest-first, trend reverses to oldest-first
      batchRunsWithExpectedForOwner: vi.fn().mockResolvedValue([olderRow, newerRow]),
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
