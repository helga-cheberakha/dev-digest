/**
 * routes.test.ts — HTTP smoke tests for agent-performance routes (T2).
 *
 * Pattern: no-DB smoke test (server/INSIGHTS.md 2026-07-05).
 *   - buildApp({ config, db: mockDb, overrides: { auth, repoIntel } })
 *   - mockDb: select().from().where() → []; execute() → []
 *     (empty agents list + empty run aggregates → zero-summary 200)
 *   - MockAuthProvider bypasses real auth; workspace 'w1' is always returned.
 *
 * Covered cases:
 *   - GET /agents/performance?period=30d → 200 (zero-run workspace, all-null summary)
 *   - GET /agents/performance?period=custom (missing from/to) → 400
 *   - GET /agents/performance?period=custom&from=2024-12-31&to=2024-01-01 (from > to) → 400
 *   - GET /agents/performance?period=custom&from=2022-01-01&to=2023-12-31 (>365d) → 400
 *   - GET /agents/:id/stats?period=30d for unknown agent → 404 with clean error envelope
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

// ─── Mock db ─────────────────────────────────────────────────────────────────

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

// ─── App factory ─────────────────────────────────────────────────────────────

async function makeTestApp(): Promise<FastifyInstance> {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const overrides: ContainerOverrides = {
    auth: new MockAuthProvider(),
    repoIntel: makeMockRepoIntel(),
  };
  return buildApp({ config, db: mockDb, overrides });
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
});
