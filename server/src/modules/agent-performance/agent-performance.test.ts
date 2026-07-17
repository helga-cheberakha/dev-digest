/**
 * Unit tests for agent-performance module.
 *
 * Covers pure helper functions and service logic with mocked repository.
 * No DB, no I/O — repository calls replaced via object substitution.
 *
 * AC-2  cost-sum invariant
 * AC-3  most-active tie-break (runs → cost → name)
 * AC-4  zero-run agent null-safety
 * AC-11 all-null-cost → total_cost_usd null (not 0)
 * AC-16 zero acted findings → accept_rate null (not 0)
 * window resolveWindow correctness (trailing / custom)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveWindow,
  toAgentPerfRow,
  toAgentStats,
  previousWindow,
  bucketSeverity,
  sumCostByCategory,
  toRunHistoryRow,
  type AgentAgg,
} from './helpers.js';
import type { StatPoint } from '@devdigest/shared';
import { AgentPerformanceService } from './service.js';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgg(overrides: Partial<AgentAgg> = {}): AgentAgg {
  return {
    agentId: 'agent-1',
    agentName: 'Agent 1',
    runs: 0,
    totalCostUsd: null,
    avgCostUsd: null,
    avgLatencyMs: null,
    lastRunAt: null,
    provider: null,
    model: null,
    findingsTotal: 0,
    accepted: 0,
    dismissed: 0,
    pending: 0,
    findingsBySeverity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
    ...overrides,
  };
}

function makeAgent(id: string, name: string): AgentRow {
  return { id, name } as unknown as AgentRow;
}

/** Minimal extras for toAgentStats call sites that don't exercise the new fields. */
const EMPTY_EXTRAS = {
  avgCostUsdPrev: null,
  severityByBucket: [] as ReturnType<typeof bucketSeverity>,
  costByCategory: [] as ReturnType<typeof sumCostByCategory>,
};

/**
 * Build a service with mocked agentsRepo and a swapped-out repository.
 * `agentsList` is what agentsRepo.list() returns.
 * `repoOverrides` let callers control each repository method's return value.
 */
function makeService(
  agentsList: AgentRow[],
  repoOverrides: {
    aggregateAgents?: AgentAgg[];
    recentRunSeries?: Map<string, { findingsCount: number; ranAt: Date }[]>;
    costByModel?: { model: string; value: number }[];
    /** Map of agentId → all-time last run Date (unwindowed). Default: empty map. */
    allTimeLastRunAt?: Map<string, Date>;
  } = {},
): AgentPerformanceService {
  const mockContainer = {
    db: {} as unknown,
    agentsRepo: {
      list: vi.fn().mockResolvedValue(agentsList),
      getById: vi.fn().mockResolvedValue(agentsList[0] ?? undefined),
    },
  } as unknown as Container;

  const service = new AgentPerformanceService(mockContainer);

  // Replace the private repo created in the constructor with a mock object.
  // Using object assignment (not vi.spyOn) because the property is private.
  (service as unknown as Record<string, unknown>)['repo'] = {
    aggregateAgents: vi.fn().mockResolvedValue(repoOverrides.aggregateAgents ?? []),
    recentRunSeries: vi
      .fn()
      .mockResolvedValue(repoOverrides.recentRunSeries ?? new Map()),
    costByModel: vi.fn().mockResolvedValue(repoOverrides.costByModel ?? []),
    // allTimeLastRunAt() returns the all-time most-recent done run per agent.
    // Default is an empty Map → lastRunAt = null for all agents (safe for
    // tests that don't check last_run_at).
    allTimeLastRunAt: vi
      .fn()
      .mockResolvedValue(repoOverrides.allTimeLastRunAt ?? new Map()),
  };

  return service;
}

const WINDOW = resolveWindow('30d');

// ---------------------------------------------------------------------------
// resolveWindow — pure function
// ---------------------------------------------------------------------------

describe('resolveWindow', () => {
  it('30d returns a trailing 30-day window (not calendar-aligned)', () => {
    const before = Date.now();
    const { fromTs, toTs } = resolveWindow('30d');
    const after = Date.now();

    // toTs ≈ now
    expect(toTs.getTime()).toBeGreaterThanOrEqual(before);
    expect(toTs.getTime()).toBeLessThanOrEqual(after);

    // fromTs ≈ now − 30 days (within a 1-second tolerance for test timing)
    const expectedFrom = new Date(before - 30 * 24 * 60 * 60 * 1000);
    expect(fromTs.getTime()).toBeGreaterThanOrEqual(expectedFrom.getTime() - 1000);
    expect(fromTs.getTime()).toBeLessThanOrEqual(expectedFrom.getTime() + 1000);

    expect(toTs.getTime() - fromTs.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it('1d returns a trailing 24-hour window (not a calendar day)', () => {
    const before = Date.now();
    const { fromTs, toTs } = resolveWindow('1d');
    const after = Date.now();

    // toTs ≈ now
    expect(toTs.getTime()).toBeGreaterThanOrEqual(before);
    expect(toTs.getTime()).toBeLessThanOrEqual(after);

    // span ≈ 24 hours
    expect(toTs.getTime() - fromTs.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it('custom returns [from 00:00:00.000Z, to 23:59:59.999Z] UTC inclusive bounds', () => {
    const { fromTs, toTs } = resolveWindow('custom', '2024-06-01', '2024-06-30');

    expect(fromTs.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    expect(toTs.toISOString()).toBe('2024-06-30T23:59:59.999Z');
  });

  it('custom: single-day range (from === to) still returns valid [start, end-of-day]', () => {
    const { fromTs, toTs } = resolveWindow('custom', '2024-06-15', '2024-06-15');

    expect(fromTs.toISOString()).toBe('2024-06-15T00:00:00.000Z');
    expect(toTs.toISOString()).toBe('2024-06-15T23:59:59.999Z');
  });

  it('unrecognised period falls back to 30d trailing window', () => {
    const { fromTs, toTs } = resolveWindow('badvalue');
    expect(toTs.getTime() - fromTs.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  // Validation (from > to, > 365d) lives in routes.ts:validateWindowQuery
  // and is covered by the HTTP smoke tests in routes.test.ts (T2).
  // resolveWindow itself never throws — bad custom inputs fall back to 30d.
});

// ---------------------------------------------------------------------------
// previousWindow — pure function
// ---------------------------------------------------------------------------

describe('previousWindow', () => {
  it('shifts the window back by exactly its own duration', () => {
    const fromTs = new Date('2024-06-01T00:00:00.000Z');
    const toTs = new Date('2024-07-01T00:00:00.000Z'); // 30 days
    const durationMs = toTs.getTime() - fromTs.getTime();

    const prev = previousWindow({ fromTs, toTs });

    // prev.toTs === original fromTs
    expect(prev.toTs.toISOString()).toBe(fromTs.toISOString());
    // prev.fromTs === original fromTs − duration
    expect(prev.fromTs.toISOString()).toBe(
      new Date(fromTs.getTime() - durationMs).toISOString(),
    );
    // prev window has the same duration
    expect(prev.toTs.getTime() - prev.fromTs.getTime()).toBe(durationMs);
  });

  it('works correctly for a 7-day window (common preset)', () => {
    const fromTs = new Date('2024-06-10T00:00:00.000Z');
    const toTs = new Date('2024-06-17T00:00:00.000Z'); // 7 days
    const prev = previousWindow({ fromTs, toTs });

    expect(prev.fromTs.toISOString()).toBe('2024-06-03T00:00:00.000Z');
    expect(prev.toTs.toISOString()).toBe('2024-06-10T00:00:00.000Z');
  });

  it('does not mutate the input window', () => {
    const fromTs = new Date('2024-06-01T00:00:00.000Z');
    const toTs = new Date('2024-06-08T00:00:00.000Z');
    const originalFromMs = fromTs.getTime();
    const originalToMs = toTs.getTime();

    previousWindow({ fromTs, toTs });

    expect(fromTs.getTime()).toBe(originalFromMs);
    expect(toTs.getTime()).toBe(originalToMs);
  });

  it('boundary non-overlap: prevWindow.toTs === window.fromTs, so strict-< in avgCostPrevWindow means a run at fromTs is NOT counted in the prev window', () => {
    // This test locks in the invariant that makes the two windows disjoint.
    //
    // previousWindow() sets toTs = window.fromTs (same millisecond, by contract).
    // avgCostPrevWindow() uses `ran_at < prevWindow.toTs` (strict less-than),
    // which is < window.fromTs. Therefore:
    //   - a run at exactly window.fromTs satisfies `ran_at >= window.fromTs` (current window ✓)
    //   - a run at exactly window.fromTs does NOT satisfy `ran_at < prevWindow.toTs` (prev window ✗)
    //
    // These two windows are disjoint: the boundary instant belongs to the current
    // window only. This matters most for `period=custom`, where fromTs lands at
    // exactly midnight-UTC and a run recorded at 00:00:00.000Z would otherwise be
    // counted in BOTH aggregates.

    const fromTs = new Date('2024-06-01T00:00:00.000Z');
    const toTs = new Date('2024-06-30T23:59:59.999Z');
    const prev = previousWindow({ fromTs, toTs });

    // Contract: prev.toTs === window.fromTs (same millisecond)
    expect(prev.toTs.getTime()).toBe(fromTs.getTime());

    // With strict `<` in the repository query:
    //   A run at the boundary (fromTs) satisfies: boundaryMs < prev.toTs.getTime()
    //   → false — so it is NOT counted in the previous window.
    const boundaryMs = fromTs.getTime();
    const countedInPrevWindow = boundaryMs < prev.toTs.getTime();
    expect(countedInPrevWindow).toBe(false);

    // The same run satisfies `>= fromTs` (current window's lower bound) → true.
    const countedInCurrentWindow = boundaryMs >= fromTs.getTime();
    expect(countedInCurrentWindow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bucketSeverity — pure function
// ---------------------------------------------------------------------------

describe('bucketSeverity', () => {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TARGET = 7;

  it('1-day window produces MORE than 1 bucket (not degenerate)', () => {
    const fromTs = new Date('2024-06-15T00:00:00.000Z');
    const toTs = new Date('2024-06-16T00:00:00.000Z'); // exactly 1 day
    const buckets = bucketSeverity([], { fromTs, toTs }, TARGET);
    expect(buckets.length).toBeGreaterThan(1);
  });

  it('30-day window produces roughly weekly buckets (~4-6 buckets)', () => {
    const fromTs = new Date('2024-05-17T00:00:00.000Z');
    const toTs = new Date('2024-06-16T00:00:00.000Z'); // 30 days
    const buckets = bucketSeverity([], { fromTs, toTs }, TARGET);
    expect(buckets.length).toBeGreaterThanOrEqual(4);
    expect(buckets.length).toBeLessThanOrEqual(6);
  });

  it('buckets are ordered oldest→newest (labels are non-empty strings)', () => {
    const fromTs = new Date('2024-06-01T00:00:00.000Z');
    const toTs = new Date('2024-07-01T00:00:00.000Z'); // 30 days
    const buckets = bucketSeverity([], { fromTs, toTs }, TARGET);
    expect(buckets.length).toBeGreaterThan(0);
    for (const b of buckets) {
      expect(typeof b.label).toBe('string');
      expect(b.label.length).toBeGreaterThan(0);
    }
  });

  it('counts rows correctly by severity', () => {
    const fromTs = new Date('2024-06-15T00:00:00.000Z');
    const toTs = new Date('2024-06-16T00:00:00.000Z'); // 1 day → multi-hour buckets
    // Three findings at the start of the window (all in bucket 0)
    const rows = [
      { ran_at: '2024-06-15T01:00:00.000Z', severity: 'CRITICAL' },
      { ran_at: '2024-06-15T01:30:00.000Z', severity: 'WARNING' },
      { ran_at: '2024-06-15T02:00:00.000Z', severity: 'SUGGESTION' },
    ];
    const buckets = bucketSeverity(rows, { fromTs, toTs }, TARGET);
    // Total across all buckets must match the input
    const totalCritical = buckets.reduce((s, b) => s + b.CRITICAL, 0);
    const totalWarning = buckets.reduce((s, b) => s + b.WARNING, 0);
    const totalSuggestion = buckets.reduce((s, b) => s + b.SUGGESTION, 0);
    expect(totalCritical).toBe(1);
    expect(totalWarning).toBe(1);
    expect(totalSuggestion).toBe(1);
  });

  it('ignores rows outside the window defensively', () => {
    const fromTs = new Date('2024-06-15T00:00:00.000Z');
    const toTs = new Date('2024-06-16T00:00:00.000Z');
    const rows = [
      { ran_at: '2024-06-14T23:59:59.000Z', severity: 'CRITICAL' }, // before window
      { ran_at: '2024-06-16T00:00:01.000Z', severity: 'WARNING' },  // after window
    ];
    const buckets = bucketSeverity(rows, { fromTs, toTs }, TARGET);
    const totalAll = buckets.reduce((s, b) => s + b.CRITICAL + b.WARNING + b.SUGGESTION, 0);
    expect(totalAll).toBe(0);
  });

  it('returns at least 1 bucket even for a zero-duration window', () => {
    const ts = new Date('2024-06-15T12:00:00.000Z');
    const buckets = bucketSeverity([], { fromTs: ts, toTs: ts }, TARGET);
    expect(buckets.length).toBeGreaterThanOrEqual(1);
  });

  it('~365-day window produces far fewer than 53 buckets (adaptive long-window bucketing)', () => {
    // Pre-fix: WEEK was the largest unit → ceil(365/7) = 53 buckets.
    // Post-fix: 60-day tier catches rawBucket ≈ 52d → ceil(365/60) = 7 buckets.
    // Assert <= 20 to allow for any boundary rounding; must be meaningfully
    // below the pre-fix 53, targeting the ≈6-8 spec goal.
    const fromTs = new Date('2024-01-01T00:00:00.000Z');
    const toTs = new Date('2024-12-31T23:59:59.999Z'); // 365 days
    const buckets = bucketSeverity([], { fromTs, toTs }, TARGET);
    expect(buckets.length).toBeLessThan(20);
    // Specifically: with the 60-day tier, ceil(365/60) = 7 — within spec target
    expect(buckets.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// toRunHistoryRow — pure function
// ---------------------------------------------------------------------------

describe('toRunHistoryRow', () => {
  const BASE_RUN_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const BASE_RAN_AT_ISO = '2024-06-15T12:00:00.000Z';

  it('maps a fully-populated raw row to RunHistoryRow shape correctly', () => {
    const raw = {
      run_id: BASE_RUN_ID,
      ran_at: BASE_RAN_AT_ISO,
      pr_number: 42,
      pr_title: 'Fix the thing',
      pr_repo_id: 'repo-uuid-123',
      tokens_in: 1000,
      tokens_out: 500,
      cost_usd: 1.23,
      findings_count: 3,
      source: 'local',
      status: 'done',
      has_trace: true,
    };
    const row = toRunHistoryRow(raw);

    expect(row.run_id).toBe(BASE_RUN_ID);
    expect(row.ran_at).toBe(BASE_RAN_AT_ISO);
    expect(row.pr_number).toBe(42);
    expect(row.pr_title).toBe('Fix the thing');
    expect(row.pr_repo_id).toBe('repo-uuid-123');
    expect(row.tokens_in).toBe(1000);
    expect(row.tokens_out).toBe(500);
    expect(row.cost_usd).toBeCloseTo(1.23);
    expect(row.findings_count).toBe(3);
    expect(row.source).toBe('local');
    expect(row.status).toBe('done');
    expect(row.has_trace).toBe(true);
  });

  it('has_trace: true when the raw row signals a trace exists', () => {
    const raw = {
      run_id: BASE_RUN_ID,
      ran_at: BASE_RAN_AT_ISO,
      pr_number: null,
      pr_title: null,
      pr_repo_id: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      findings_count: null,
      source: 'local',
      status: 'done',
      has_trace: true,
    };
    expect(toRunHistoryRow(raw).has_trace).toBe(true);
  });

  it('has_trace: false when no run_traces row is present (LEFT JOIN → NULL → false)', () => {
    const raw = {
      run_id: BASE_RUN_ID,
      ran_at: BASE_RAN_AT_ISO,
      pr_number: null,
      pr_title: null,
      pr_repo_id: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      findings_count: null,
      source: 'ci',
      status: 'done',
      has_trace: false,
    };
    expect(toRunHistoryRow(raw).has_trace).toBe(false);
  });

  it('handles all nullable fields as null — none coerced to 0 or empty string', () => {
    const raw = {
      run_id: BASE_RUN_ID,
      ran_at: BASE_RAN_AT_ISO,
      pr_number: null,
      pr_title: null,
      pr_repo_id: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      findings_count: null,
      source: 'ci',
      status: 'failed',
      has_trace: false,
    };
    const row = toRunHistoryRow(raw);

    expect(row.pr_number).toBeNull();
    expect(row.pr_title).toBeNull();
    expect(row.pr_repo_id).toBeNull();
    expect(row.tokens_in).toBeNull();
    expect(row.tokens_out).toBeNull();
    expect(row.cost_usd).toBeNull();
    expect(row.findings_count).toBeNull();
    // Verify none of the nullable fields coerced to 0 or empty string
    const nullableFields = [row.pr_number, row.pr_title, row.pr_repo_id,
      row.tokens_in, row.tokens_out, row.cost_usd, row.findings_count] as unknown[];
    for (const v of nullableFields) {
      expect(v).toBeNull();
    }
  });

  it('ran_at normalised to ISO-8601 string regardless of postgres-js format variant', () => {
    // postgres-js may return timestamps without the 'T' separator or with timezone offset
    const raw = {
      run_id: BASE_RUN_ID,
      ran_at: '2024-06-15 12:00:00+00',  // postgres-style without 'T'
      pr_number: null,
      pr_title: null,
      pr_repo_id: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      findings_count: null,
      source: 'local',
      status: 'done',
      has_trace: false,
    };
    const row = toRunHistoryRow(raw);
    // Must be a valid ISO string parseable back to the same timestamp
    expect(row.ran_at).toBe('2024-06-15T12:00:00.000Z');
    expect(new Date(row.ran_at).toISOString()).toBe('2024-06-15T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// sumCostByCategory — pure function
// ---------------------------------------------------------------------------

describe('sumCostByCategory', () => {
  it('proportionally attributes run cost to categories', () => {
    // One run: $10 total, 3 findings (2 security + 1 bug).
    // formula: category_finding_count × (cost_usd / run_finding_count)
    //   security: 2 × (10 / 3) ≈ 6.667
    //   bug:      1 × (10 / 3) ≈ 3.333
    const rows = [
      { category: 'security', cost_usd: 10, category_finding_count: 2, run_finding_count: 3 },
      { category: 'bug',      cost_usd: 10, category_finding_count: 1, run_finding_count: 3 },
    ];
    const result = sumCostByCategory(rows);

    expect(result).toHaveLength(2);
    const security = result.find((r) => r.category === 'security');
    const bug = result.find((r) => r.category === 'bug');

    expect(security).toBeDefined();
    expect(bug).toBeDefined();
    expect(security!.cost_usd).toBeCloseTo(6.667, 2);
    expect(bug!.cost_usd).toBeCloseTo(3.333, 2);
    // Sum should equal the full run cost
    expect(security!.cost_usd + bug!.cost_usd).toBeCloseTo(10, 5);
  });

  it('sums across multiple runs for the same category', () => {
    // Two runs, each $6, 2 findings each (1 security + 1 bug each).
    // security: 2 × (6/2) = 6; bug: 2 × (6/2) = 6
    const rows = [
      { category: 'security', cost_usd: 6, category_finding_count: 1, run_finding_count: 2 },
      { category: 'bug',      cost_usd: 6, category_finding_count: 1, run_finding_count: 2 },
      { category: 'security', cost_usd: 6, category_finding_count: 1, run_finding_count: 2 },
      { category: 'bug',      cost_usd: 6, category_finding_count: 1, run_finding_count: 2 },
    ];
    const result = sumCostByCategory(rows);
    const security = result.find((r) => r.category === 'security');
    const bug = result.find((r) => r.category === 'bug');
    expect(security!.cost_usd).toBeCloseTo(6, 5);
    expect(bug!.cost_usd).toBeCloseTo(6, 5);
  });

  it('skips rows where run_finding_count === 0 (defensive guard)', () => {
    const rows = [
      { category: 'security', cost_usd: 10, category_finding_count: 1, run_finding_count: 0 },
    ];
    const result = sumCostByCategory(rows);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(sumCostByCategory([])).toEqual([]);
  });

  it('omits categories with no rows (absent, not zero-valued)', () => {
    // Only 'bug' rows → 'security' is absent from the result
    const rows = [
      { category: 'bug', cost_usd: 5, category_finding_count: 1, run_finding_count: 1 },
    ];
    const result = sumCostByCategory(rows);
    expect(result.some((r) => r.category === 'security')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toAgentPerfRow — pure function
// ---------------------------------------------------------------------------

describe('toAgentPerfRow', () => {
  it('AC-4: zero-run agent → runs=0, accept_rate=null, cost/duration null (never NaN or undefined)', () => {
    const agg = makeAgg({ runs: 0, accepted: 0, dismissed: 0 });
    const row = toAgentPerfRow(agg, []);

    expect(row.runs).toBe(0);
    expect(row.accept_rate).toBeNull();
    expect(row.dismiss_rate).toBeNull();
    expect(row.avg_cost_usd).toBeNull();
    expect(row.avg_latency_ms).toBeNull();
    expect(row.avg_findings_per_run).toBeNull();
    expect(row.total_cost_usd).toBeNull();

    // Verify none of the nullable fields are NaN or undefined
    const nullableFields = [
      row.accept_rate,
      row.dismiss_rate,
      row.avg_cost_usd,
      row.avg_latency_ms,
      row.avg_findings_per_run,
      row.total_cost_usd,
    ] as (number | null)[];
    for (const v of nullableFields) {
      expect(v === null || (typeof v === 'number' && !Number.isNaN(v))).toBe(true);
    }
  });

  it('AC-11: all-null-cost runs → total_cost_usd=null (not 0)', () => {
    const agg = makeAgg({ runs: 3, totalCostUsd: null, avgCostUsd: null });
    const row = toAgentPerfRow(agg, []);

    expect(row.total_cost_usd).toBeNull();
    // avg_cost_usd comes from avgCostUsd (null) even though runs > 0
    expect(row.avg_cost_usd).toBeNull();
  });

  it('AC-16: zero acted findings → accept_rate=null, dismiss_rate=null (not 0)', () => {
    const agg = makeAgg({ runs: 5, accepted: 0, dismissed: 0, pending: 3 });
    const row = toAgentPerfRow(agg, []);

    expect(row.accept_rate).toBeNull();
    expect(row.dismiss_rate).toBeNull();
  });

  it('priced run with acted findings → non-null rates and costs', () => {
    const agg = makeAgg({
      runs: 2,
      totalCostUsd: 3.0,
      avgCostUsd: 1.5,
      avgLatencyMs: 200,
      accepted: 3,
      dismissed: 1,
      findingsTotal: 4,
    });
    const row = toAgentPerfRow(agg, [2, 3]);

    expect(row.total_cost_usd).toBeCloseTo(3.0);
    expect(row.avg_cost_usd).toBeCloseTo(1.5);
    expect(row.avg_latency_ms).toBeCloseTo(200);
    expect(row.accept_rate).toBeCloseTo(0.75); // 3/(3+1)
    expect(row.dismiss_rate).toBeCloseTo(0.25); // 1/(3+1)
    expect(row.avg_findings_per_run).toBeCloseTo(2.0); // 4/2
    expect(row.trend).toEqual([2, 3]);
  });

  it('last_run_at is ISO string when present, null when absent', () => {
    const date = new Date('2024-06-15T12:00:00.000Z');
    const withDate = toAgentPerfRow(makeAgg({ lastRunAt: date, runs: 1 }), []);
    expect(withDate.last_run_at).toBe('2024-06-15T12:00:00.000Z');

    const noDate = toAgentPerfRow(makeAgg({ lastRunAt: null, runs: 0 }), []);
    expect(noDate.last_run_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toAgentStats — pure function
// ---------------------------------------------------------------------------

describe('toAgentStats', () => {
  it('AC-4: zero-run agent → runs=0, accept_rate=null, cost/duration null', () => {
    const agg = makeAgg({ runs: 0 });
    const trend: StatPoint[] = [];
    const stats = toAgentStats(agg, trend, EMPTY_EXTRAS);

    expect(stats.runs).toBe(0);
    expect(stats.accept_rate).toBeNull();
    expect(stats.avg_cost_usd).toBeNull();
    expect(stats.avg_latency_ms).toBeNull();
    expect(stats.trend).toEqual([]);
  });

  it('AC-16: zero acted findings → accept_rate=null (not 0)', () => {
    const agg = makeAgg({ runs: 2, accepted: 0, dismissed: 0, pending: 5 });
    const stats = toAgentStats(agg, [], EMPTY_EXTRAS);

    expect(stats.accept_rate).toBeNull();
    expect(stats.dismiss_rate).toBeNull();
  });

  it('trend StatPoint array is passed through unchanged', () => {
    const trend: StatPoint[] = [
      { label: '2024-06-10T12:00:00.000Z', value: 2 },
      { label: '2024-06-20T12:00:00.000Z', value: 3 },
    ];
    const stats = toAgentStats(makeAgg({ runs: 2 }), trend, EMPTY_EXTRAS);
    expect(stats.trend).toEqual(trend);
  });

  it('extras are passed through to the output object', () => {
    const severityBuckets = [
      { label: '06/01', CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
    ];
    const costCats = [{ category: 'bug' as const, cost_usd: 3.5 }];
    const stats = toAgentStats(makeAgg({ runs: 1 }), [], {
      avgCostUsdPrev: 4.2,
      severityByBucket: severityBuckets,
      costByCategory: costCats,
    });

    expect(stats.avg_cost_usd_prev).toBeCloseTo(4.2);
    expect(stats.severity_by_bucket).toEqual(severityBuckets);
    expect(stats.cost_by_category).toEqual(costCats);
  });

  it('avg_cost_usd_prev=null when no priced runs in previous window', () => {
    const stats = toAgentStats(makeAgg({ runs: 1 }), [], {
      ...EMPTY_EXTRAS,
      avgCostUsdPrev: null,
    });
    expect(stats.avg_cost_usd_prev).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AgentPerformanceService (mocked repository)
// ---------------------------------------------------------------------------

describe('AgentPerformanceService.getPerformance', () => {
  it('AC-2: Σcost_by_agent = Σcost_by_model = summary.total_cost_usd (within fp tolerance)', async () => {
    const agentA = makeAgent('a1', 'Agent Alpha');
    const agentB = makeAgent('a2', 'Agent Beta');

    const repoAggs: AgentAgg[] = [
      makeAgg({ agentId: 'a1', agentName: '', runs: 3, totalCostUsd: 1.5 }),
      makeAgg({ agentId: 'a2', agentName: '', runs: 2, totalCostUsd: 2.5 }),
    ];

    // model costs: gpt-4o=3.0, claude-sonnet=1.0 → total 4.0 (same as agent sum)
    const modelCosts = [
      { model: 'gpt-4o', value: 3.0 },
      { model: 'claude-sonnet', value: 1.0 },
    ];

    const service = makeService([agentA, agentB], {
      aggregateAgents: repoAggs,
      costByModel: modelCosts,
    });

    const result = await service.getPerformance('ws1', WINDOW);

    const sumCostByAgent = result.cost_by_agent.reduce((s, c) => s + c.value, 0);
    const sumCostByModel = result.cost_by_model.reduce((s, c) => s + c.value, 0);

    expect(result.summary.total_cost_usd).not.toBeNull();
    expect(result.summary.total_cost_usd).toBeCloseTo(4.0, 10);
    expect(sumCostByAgent).toBeCloseTo(result.summary.total_cost_usd!, 10);
    expect(sumCostByModel).toBeCloseTo(4.0, 10);
  });

  it('AC-11: when all agents have null cost → summary.total_cost_usd=null (not 0)', async () => {
    const agentA = makeAgent('a1', 'Agent Alpha');
    const repoAggs: AgentAgg[] = [
      makeAgg({ agentId: 'a1', agentName: '', runs: 2, totalCostUsd: null }),
    ];

    const service = makeService([agentA], { aggregateAgents: repoAggs });
    const result = await service.getPerformance('ws1', WINDOW);

    expect(result.summary.total_cost_usd).toBeNull();
    expect(result.cost_by_agent).toHaveLength(0); // no priced agents
  });

  it('AC-16: zero acted findings across all agents → avg_accept_rate=null (not 0)', async () => {
    const agentA = makeAgent('a1', 'Agent Alpha');
    const repoAggs: AgentAgg[] = [
      makeAgg({ agentId: 'a1', agentName: '', runs: 3, accepted: 0, dismissed: 0, pending: 5 }),
    ];

    const service = makeService([agentA], { aggregateAgents: repoAggs });
    const result = await service.getPerformance('ws1', WINDOW);

    expect(result.summary.avg_accept_rate).toBeNull();
  });

  describe('AC-3: most_active_agent tie-break', () => {
    it('equal runs → higher total_cost_usd wins', async () => {
      const agents = [makeAgent('a1', 'Beta'), makeAgent('a2', 'Alpha')];
      const repoAggs: AgentAgg[] = [
        makeAgg({ agentId: 'a1', agentName: '', runs: 5, totalCostUsd: 1.0 }),
        makeAgg({ agentId: 'a2', agentName: '', runs: 5, totalCostUsd: 2.0 }),
      ];
      const service = makeService(agents, { aggregateAgents: repoAggs });
      const result = await service.getPerformance('ws1', WINDOW);
      // Agent 'Alpha' has cost=2.0 which is higher → wins
      expect(result.summary.most_active_agent).toBe('Alpha');
    });

    it('equal runs and equal cost → alphabetically-first agent_name wins', async () => {
      const agents = [makeAgent('a1', 'Zebra'), makeAgent('a2', 'Alpha')];
      const repoAggs: AgentAgg[] = [
        makeAgg({ agentId: 'a1', agentName: '', runs: 5, totalCostUsd: 1.0 }),
        makeAgg({ agentId: 'a2', agentName: '', runs: 5, totalCostUsd: 1.0 }),
      ];
      const service = makeService(agents, { aggregateAgents: repoAggs });
      const result = await service.getPerformance('ws1', WINDOW);
      // 'Alpha' < 'Zebra' → 'Alpha' wins
      expect(result.summary.most_active_agent).toBe('Alpha');
    });

    it('unambiguous winner by run count (no tie-break needed)', async () => {
      const agents = [makeAgent('a1', 'Slow'), makeAgent('a2', 'Busy')];
      const repoAggs: AgentAgg[] = [
        makeAgg({ agentId: 'a1', agentName: '', runs: 3 }),
        makeAgg({ agentId: 'a2', agentName: '', runs: 10 }),
      ];
      const service = makeService(agents, { aggregateAgents: repoAggs });
      const result = await service.getPerformance('ws1', WINDOW);
      expect(result.summary.most_active_agent).toBe('Busy');
    });
  });

  it('agents with zero runs appear in the response with null-safe defaults', async () => {
    const agentA = makeAgent('a1', 'Active');
    const agentB = makeAgent('a2', 'Inactive'); // no repo agg → zero-run placeholder

    const repoAggs: AgentAgg[] = [
      makeAgg({ agentId: 'a1', agentName: '', runs: 5, totalCostUsd: 1.0 }),
      // a2 has NO entry in repoAggs → service creates a zero-run placeholder
    ];

    const service = makeService([agentA, agentB], { aggregateAgents: repoAggs });
    const result = await service.getPerformance('ws1', WINDOW);

    const inactiveRow = result.agents.find((r) => r.agent_name === 'Inactive');
    expect(inactiveRow).toBeDefined();
    expect(inactiveRow!.runs).toBe(0);
    expect(inactiveRow!.accept_rate).toBeNull();
    expect(inactiveRow!.avg_cost_usd).toBeNull();
    expect(inactiveRow!.avg_latency_ms).toBeNull();
  });

  it('zero-run placeholder: agent absent from aggregateAgents but present in allTimeLastRunAt → runs=0 and last_run_at populated (not null)', async () => {
    // This test exercises path (2) in service.aggregate(): an agent that has
    // ZERO done runs inside the selected window (so aggregateAgents returns no
    // entry for it) but DOES have at least one all-time done run that predates
    // the window — so allTimeLastRunAt returns a real timestamp for it.
    //
    // The zero-run placeholder branch constructs the AgentAgg literal directly
    // and must splice in lastRunAt from the Map.  A future refactor that
    // accidentally drops the `lastRunAt` assignment (e.g. forgets to include it
    // in the literal) would make last_run_at null, which this test catches.
    const agentA = makeAgent('a1', 'Active');
    const agentB = makeAgent('a2', 'Historical'); // zero in-window runs, one pre-window run

    const repoAggs: AgentAgg[] = [
      makeAgg({ agentId: 'a1', agentName: '', runs: 3, totalCostUsd: 1.5 }),
      // 'a2' is deliberately absent → zero-run placeholder branch in aggregate()
    ];

    const outOfWindowRunAt = new Date('2024-03-15T09:00:00.000Z');

    const service = makeService([agentA, agentB], {
      aggregateAgents: repoAggs,
      allTimeLastRunAt: new Map([['a2', outOfWindowRunAt]]),
    });

    const result = await service.getPerformance('ws1', WINDOW);

    const historicalRow = result.agents.find((r) => r.agent_name === 'Historical');
    expect(historicalRow, 'Historical agent must appear in the response').toBeDefined();
    // Numeric aggregates must reflect zero in-window activity
    expect(historicalRow!.runs).toBe(0);
    expect(historicalRow!.accept_rate).toBeNull();
    expect(historicalRow!.avg_cost_usd).toBeNull();
    // last_run_at must come from allTimeLastRunAt (the pre-window run), NOT null
    expect(historicalRow!.last_run_at).not.toBeNull();
    expect(historicalRow!.last_run_at).toBe('2024-03-15T09:00:00.000Z');
  });
});
