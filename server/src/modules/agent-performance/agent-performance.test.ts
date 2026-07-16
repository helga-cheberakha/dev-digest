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
    const stats = toAgentStats(agg, trend);

    expect(stats.runs).toBe(0);
    expect(stats.accept_rate).toBeNull();
    expect(stats.avg_cost_usd).toBeNull();
    expect(stats.avg_latency_ms).toBeNull();
    expect(stats.trend).toEqual([]);
  });

  it('AC-16: zero acted findings → accept_rate=null (not 0)', () => {
    const agg = makeAgg({ runs: 2, accepted: 0, dismissed: 0, pending: 5 });
    const stats = toAgentStats(agg, []);

    expect(stats.accept_rate).toBeNull();
    expect(stats.dismiss_rate).toBeNull();
  });

  it('trend StatPoint array is passed through unchanged', () => {
    const trend: StatPoint[] = [
      { label: '2024-06-10T12:00:00.000Z', value: 2 },
      { label: '2024-06-20T12:00:00.000Z', value: 3 },
    ];
    const stats = toAgentStats(makeAgg({ runs: 2 }), trend);
    expect(stats.trend).toEqual(trend);
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
});
