/**
 * routes.test.ts — HTTP smoke tests for agent-performance routes (T2 + T3).
 *
 * Pattern: no-DB smoke test (server/INSIGHTS.md 2026-07-05).
 *   - buildApp({ config, db: mockDb, overrides: { auth, repoIntel } })
 *   - mockDb: select().from().where() → []; execute() → []
 *     (empty agents list + empty run aggregates → zero-summary 200)
 *   - MockAuthProvider bypasses real auth; workspace 'w1' is always returned.
 *
 * Two mockDb variants are used:
 *   mockDb          — select().from().where() → [] (no agent found → 404)
 *   mockDbWithAgent — select().from().where() → [fakeAgent] (agent found → 200)
 *
 * Covered cases:
 *   - GET /agents/performance?period=30d → 200 (zero-run workspace, all-null summary)
 *   - GET /agents/performance?period=custom (missing from/to) → 400
 *   - GET /agents/performance?period=custom&from=2024-12-31&to=2024-01-01 (from > to) → 400
 *   - GET /agents/performance?period=custom&from=2022-01-01&to=2023-12-31 (>365d) → 400
 *   - GET /agents/:id/stats?period=30d for unknown agent → 404 with clean error envelope
 *   - GET /agents/:id/stats?period=30d for known agent → 200, includes 3 new fields
 *   - GET /agents/:id/runs?period=30d for known agent → 200 with AgentRunHistory shape
 *   - GET /agents/:id/runs?period=30d for unknown agent → 404
 *   - GET /agents/:id/runs with default page/limit → defaults applied correctly
 */

import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider } from '../../adapters/mocks.js';
import type { RepoIntel } from '../repo-intel/types.js';
import type { Db } from '../../db/client.js';
import type { ContainerOverrides } from '../../platform/container.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Any valid UUID (ZodTypeProvider validates :id params as UUIDs).
 * This ID does not exist in the mock workspace — used for 404 tests.
 */
const AGENT_ID = '00000000-0000-0000-0000-000000000001';

// ─── Mock db (no-agent variant) ──────────────────────────────────────────────

/**
 * Minimal mock Db for no-DB smoke tests.
 *
 * AgentsRepository.list/getById uses select().from().where() → [].
 * AgentPerformanceRepository uses execute() for raw SQL → [].
 *   (runRows empty → aggregateAgents returns [] → agents list empty → 200)
 *   (agentsRepo.getById returns undefined → NotFoundError → 404)
 *
 * db.update() is intentionally absent: reapStaleRunningRuns() throws on boot,
 * which buildApp wraps in a non-fatal try/catch (INSIGHTS 2026-07-05).
 *
 * db.execute() returning [] also satisfies GET /health/ready (select 1) —
 * the endpoint just checks that it doesn't throw.
 */
const mockDb: Db = {
  select: () => ({
    from: () => ({
      where: async () => [],
    }),
  }),
  execute: async () => [],
} as unknown as Db;

// ─── Mock db (with-agent variant) ────────────────────────────────────────────

/**
 * Mock Db variant where select().from().where() returns a fake agent row.
 *
 * This makes AgentsRepository.getById() return the fakeAgent (not undefined),
 * so service.getAgentStats() and service.getAgentRuns() proceed past the
 * ownership check and return a 200 instead of 404.
 *
 * execute() still returns [] — all repository aggregation queries get empty
 * results, producing zero-run / empty-rows responses that still pass Zod parse.
 */
const fakeAgentRow = { id: AGENT_ID, workspaceId: 'w1', name: 'Test Agent' };
const mockDbWithAgent: Db = {
  select: () => ({
    from: () => ({
      where: async () => [fakeAgentRow],
    }),
  }),
  execute: async () => [],
} as unknown as Db;

// ─── Mock RepoIntel ──────────────────────────────────────────────────────────

function makeMockRepoIntel(overrides: Partial<RepoIntel> = {}): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({
      status: 'full',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
    }),
    getIndexState: async (repoId) => ({
      repoId,
      status: 'full',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: 'abc123',
      indexerVersion: 1,
      updatedAt: new Date(),
    }),
    getBlastRadius: async () => ({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    }),
    getReachableEndpoints: async () => ({}),
    getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => [],
    getCriticalPaths: async () => [],
    ...overrides,
  };
}

// ─── App factories ────────────────────────────────────────────────────────────

async function makeTestApp(): Promise<FastifyInstance> {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const overrides: ContainerOverrides = {
    auth: new MockAuthProvider(),
    repoIntel: makeMockRepoIntel(),
  };
  return buildApp({ config, db: mockDb, overrides });
}

/** App variant where the mock db returns a fake agent row for agentsRepo.getById(). */
async function makeTestAppWithAgent(): Promise<FastifyInstance> {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const overrides: ContainerOverrides = {
    auth: new MockAuthProvider(),
    repoIntel: makeMockRepoIntel(),
  };
  return buildApp({ config, db: mockDbWithAgent, overrides });
}

// ─── GET /agents/performance ─────────────────────────────────────────────────

describe('GET /agents/performance', () => {
  it('returns 200 with period=30d (zero-run workspace produces all-null summary)', async () => {
    const app = await makeTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?period=30d',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        summary: { runs: number; total_cost_usd: null; avg_accept_rate: null; most_active_agent: null };
        agents: unknown[];
        cost_by_agent: unknown[];
        cost_by_model: unknown[];
      }>();
      // Summary present with zero-run defaults
      expect(body.summary).toBeDefined();
      expect(body.summary.runs).toBe(0);
      expect(body.summary.total_cost_usd).toBeNull();
      expect(body.summary.avg_accept_rate).toBeNull();
      expect(body.summary.most_active_agent).toBeNull();
      // Empty arrays for agents and cost segments
      expect(body.agents).toEqual([]);
      expect(body.cost_by_agent).toEqual([]);
      expect(body.cost_by_model).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with period=1d (zero-run workspace produces all-null summary)', async () => {
    const app = await makeTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?period=1d',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        summary: { runs: number; total_cost_usd: null; avg_accept_rate: null; most_active_agent: null };
        agents: unknown[];
        cost_by_agent: unknown[];
        cost_by_model: unknown[];
      }>();
      expect(body.summary).toBeDefined();
      expect(body.summary.runs).toBe(0);
      expect(body.summary.total_cost_usd).toBeNull();
      expect(body.summary.avg_accept_rate).toBeNull();
      expect(body.summary.most_active_agent).toBeNull();
      expect(body.agents).toEqual([]);
      expect(body.cost_by_agent).toEqual([]);
      expect(body.cost_by_model).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when period=custom and from/to are missing', async () => {
    const app = await makeTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?period=custom',
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when period=custom and from > to', async () => {
    const app = await makeTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?period=custom&from=2024-12-31&to=2024-01-01',
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when period=custom and range exceeds 365 days', async () => {
    const app = await makeTestApp();
    try {
      // from 2022-01-01 to 2023-12-31 = 729 days → exceeds MAX_RANGE_DAYS (365)
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?period=custom&from=2022-01-01&to=2023-12-31',
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

// ─── GET /agents/:id/stats ────────────────────────────────────────────────────

describe('GET /agents/:id/stats', () => {
  it('returns 404 with clean error envelope for unknown agent (not in workspace)', async () => {
    const app = await makeTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/stats?period=30d`,
      });
      expect(res.statusCode).toBe(404);

      // Verify the error envelope is clean — no workspace data leaked.
      const body = res.json<{ error: { code: string; message: string }; agent_id?: unknown }>();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('not_found');
      expect(body.error.message).toBe('Agent not found');
      // No agent-data fields in the body
      expect(body.agent_id).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 200 with 3 new enrichment fields for a known agent', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/stats?period=30d`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{
        agent_id: string;
        avg_cost_usd_prev: unknown;
        severity_by_bucket: unknown[];
        cost_by_category: unknown[];
      }>();

      // Core fields present
      expect(body.agent_id).toBe(AGENT_ID);

      // 3 new T3 fields must be present (even if empty/null — no priced runs in mock)
      expect('avg_cost_usd_prev' in body).toBe(true);
      expect('severity_by_bucket' in body).toBe(true);
      expect('cost_by_category' in body).toBe(true);

      // With no priced runs in the mock: prev window avg must be null, not 0
      expect(body.avg_cost_usd_prev).toBeNull();
      // severity_by_bucket is an array (may be non-empty; the window bucketer
      // still creates time slots even when there are no findings)
      expect(Array.isArray(body.severity_by_bucket)).toBe(true);
      // cost_by_category is empty (no priced runs)
      expect(body.cost_by_category).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with 3 new enrichment fields for a known agent with period=1d', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/stats?period=1d`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{
        agent_id: string;
        avg_cost_usd_prev: unknown;
        severity_by_bucket: unknown[];
        cost_by_category: unknown[];
      }>();

      expect(body.agent_id).toBe(AGENT_ID);
      expect('avg_cost_usd_prev' in body).toBe(true);
      expect('severity_by_bucket' in body).toBe(true);
      expect('cost_by_category' in body).toBe(true);
      expect(body.avg_cost_usd_prev).toBeNull();
      expect(Array.isArray(body.severity_by_bucket)).toBe(true);
      expect(body.cost_by_category).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

// ─── GET /agents/:id/runs ─────────────────────────────────────────────────────

describe('GET /agents/:id/runs', () => {
  it('returns 404 for an out-of-workspace agent id', async () => {
    const app = await makeTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/runs?period=30d`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe('not_found');
      expect(body.error.message).toBe('Agent not found');
    } finally {
      await app.close();
    }
  });

  it('returns 200 with AgentRunHistory shape for a valid request', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/runs?period=30d`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{ rows: unknown[]; page: number; limit: number; total: number }>();
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows).toEqual([]); // no runs in mock
      expect(body.page).toBe(1); // default page
      expect(body.limit).toBe(25); // RUN_HISTORY_DEFAULT_LIMIT default
      expect(body.total).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('respects explicit page and limit querystring params', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/runs?period=30d&page=2&limit=10`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ page: number; limit: number }>();
      expect(body.page).toBe(2);
      expect(body.limit).toBe(10);
    } finally {
      await app.close();
    }
  });

  it('limit is clamped to RUN_HISTORY_MAX_LIMIT (100) when over-specified', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/runs?period=30d&limit=999`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ limit: number }>();
      expect(body.limit).toBeLessThanOrEqual(100); // RUN_HISTORY_MAX_LIMIT
    } finally {
      await app.close();
    }
  });

  it('returns 400 for period=custom without from/to', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/runs?period=custom`,
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with AgentRunHistory shape for period=1d', async () => {
    const app = await makeTestAppWithAgent();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT_ID}/runs?period=1d`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{ rows: unknown[]; page: number; limit: number; total: number }>();
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows).toEqual([]);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(25); // RUN_HISTORY_DEFAULT_LIMIT default
      expect(body.total).toBe(0);
    } finally {
      await app.close();
    }
  });
});
