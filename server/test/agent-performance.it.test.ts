/**
 * Integration tests for agent-performance routes (T3).
 *
 * Requires Docker (Testcontainers). Self-skips when Docker is unavailable.
 *
 * Covers:
 *   AC-1  GET /agents/performance and GET /agents/:id/stats agree field-for-field
 *         (runs, avg_cost_usd, avg_latency_ms, accept_rate) for the same agent
 *   AC-12 Workspace isolation / no IDOR: requesting workspace B's agent from
 *         workspace A's context returns 404 with no B data leaked
 *   AC-13a Trend agreement: dashboard row trend[] values match stats trend[].values
 *   AC-15 Neither endpoint touches LLMProvider or run-executor (static code grep)
 *
 * Array-binding path: recentRunSeries uses ARRAY[...]::uuid[] (INSIGHTS 2026-07-16).
 * This is exercised implicitly by every test that calls the performance endpoint
 * with active agents — the real Postgres validates the binding.
 *
 * Window scoping: seed agent_runs are placed in 2024-06-01..2024-06-30.
 * Runs outside that window (2024-01-01) and non-done runs are seeded to verify exclusion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agent-performance] Docker not available — skipping integration tests.');
}

// ---------------------------------------------------------------------------
// Shared state — populated in beforeAll
// ---------------------------------------------------------------------------

// Window used across all tests: a past date range with no ambiguity
const FROM = '2024-06-01';
const TO = '2024-06-30';
const PERIOD_QUERY = `period=custom&from=${FROM}&to=${TO}`;

d('AgentPerformance routes — integration (real Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;    // "default" workspace (workspace A)
  let agentAlphaId: string;
  let agentBetaId: string;
  let agentGammaId: string;   // zero in-window runs, one pre-window done run
  let agentWsBId: string;     // workspace-B agent for IDOR test
  let wsBId: string;
  // Run IDs used by the GET /agents/:id/runs has_trace tests
  let runA1Id: string;        // seeded with a run_traces row → has_trace: true
  let runA2Id: string;        // no run_traces row → has_trace: false

  beforeAll(async () => {
    pg = await startPg();
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

    // seed() creates the "default" workspace + user + demo data.
    // LocalNoAuthProvider (used by default in buildApp) resolves this workspace.
    const { workspaceId: wsId } = await seed(pg.handle.db);
    workspaceId = wsId;
    const db = pg.handle.db;

    // ---- Insert test agents in workspace A ----
    const [alphaAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'IT Agent Alpha',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'Test agent alpha.',
      })
      .returning();
    agentAlphaId = alphaAgent!.id;

    const [betaAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'IT Agent Beta',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'Test agent beta.',
      })
      .returning();
    agentBetaId = betaAgent!.id;

    // ---- Insert a repo + PR (needed for reviews.prId NOT NULL constraint) ----
    const [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'it-owner',
        name: 'perf-test-repo',
        fullName: 'it-owner/perf-test-repo',
      })
      .returning();
    const repoId = repo!.id;

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9001,
        title: 'IT perf test PR',
        author: 'it-tester',
        branch: 'feat/perf-test',
        base: 'main',
        headSha: 'deadbeef',
        status: 'open',
      })
      .returning();
    const prId = pr!.id;

    // ---- Insert agent_runs for Agent Alpha ----
    // A1: done, priced, in window
    const [runA1] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentAlphaId,
        status: 'done',
        ranAt: new Date('2024-06-10T12:00:00.000Z'),
        costUsd: 1.5,
        durationMs: 100,
        findingsCount: 2,
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    runA1Id = runA1!.id;

    // A2: done, null cost, in window
    const [runA2] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentAlphaId,
        status: 'done',
        ranAt: new Date('2024-06-20T12:00:00.000Z'),
        costUsd: null,
        durationMs: 200,
        findingsCount: 3,
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    runA2Id = runA2!.id;

    // A3: failed in window — should be EXCLUDED from aggregateAgents (status != 'done')
    await db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentAlphaId,
      status: 'failed',
      ranAt: new Date('2024-06-25T12:00:00.000Z'),
      costUsd: 999.0,
      durationMs: 50,
      findingsCount: 10,
    });

    // A_out: done but OUTSIDE the window — should be EXCLUDED by ranAt filter
    await db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentAlphaId,
      status: 'done',
      ranAt: new Date('2024-01-01T12:00:00.000Z'),
      costUsd: 999.0,
      durationMs: 999,
      findingsCount: 99,
    });

    // Seed a run_traces row for A1 so GET /agents/:id/runs returns has_trace=true for it.
    // A2 intentionally has no trace row → has_trace=false in the response.
    await db.insert(t.runTraces).values({ runId: runA1Id, trace: { seeded: true } });

    // ---- Insert agent_runs for Agent Beta ----
    // B1: done, priced, in window
    const [runB1] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentBetaId,
        status: 'done',
        ranAt: new Date('2024-06-12T12:00:00.000Z'),
        costUsd: 2.5,
        durationMs: 150,
        findingsCount: 1,
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();

    // B_pending: running (non-done) in window — should be EXCLUDED
    await db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentBetaId,
      status: 'running',
      ranAt: new Date('2024-06-28T12:00:00.000Z'),
    });

    // ---- Insert Agent Gamma: zero in-window runs, one done run before the window ----
    // This seeds the zero-run placeholder branch in service.aggregate():
    // aggregateAgents will return no entry for Gamma (no done runs in June 2024),
    // but allTimeLastRunAt will return 2024-01-15 for it.
    const [gammaAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'IT Agent Gamma',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'Test agent gamma — pre-window run only.',
      })
      .returning();
    agentGammaId = gammaAgent!.id;

    // G_out: done run OUTSIDE the query window (2024-06-01..2024-06-30)
    await db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentGammaId,
      status: 'done',
      ranAt: new Date('2024-01-15T12:00:00.000Z'),
      costUsd: null,
      durationMs: 120,
      findingsCount: 4,
    });

    // ---- Insert reviews + findings for Alpha (A1 and A2) ----
    // Review for A1: 1 accepted, 1 dismissed (acted=2, accept_rate=0.5)
    const [revA1] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: agentAlphaId,
        runId: runA1!.id,
        kind: 'review',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: revA1!.id,
        file: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        severity: 'CRITICAL',
        category: 'security',
        title: 'F1 accepted',
        rationale: 'test',
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: new Date('2024-06-10T13:00:00.000Z'),
        dismissedAt: null,
      },
      {
        reviewId: revA1!.id,
        file: 'src/foo.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'style',
        title: 'F2 dismissed',
        rationale: 'test',
        confidence: 0.7,
        kind: 'finding',
        acceptedAt: null,
        dismissedAt: new Date('2024-06-10T13:00:00.000Z'),
      },
    ]);

    // Review for A2: 1 pending finding
    const [revA2] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: agentAlphaId,
        runId: runA2!.id,
        kind: 'review',
      })
      .returning();

    await db.insert(t.findings).values({
      reviewId: revA2!.id,
      file: 'src/bar.ts',
      startLine: 5,
      endLine: 5,
      severity: 'SUGGESTION',
      category: 'readability',
      title: 'F3 pending',
      rationale: 'test',
      confidence: 0.5,
      kind: 'finding',
      acceptedAt: null,
      dismissedAt: null,
    });

    // ---- Insert review + finding for Beta (B1) ----
    // 1 accepted finding (acted=1, accept_rate=1.0)
    const [revB1] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: agentBetaId,
        runId: runB1!.id,
        kind: 'review',
      })
      .returning();

    await db.insert(t.findings).values({
      reviewId: revB1!.id,
      file: 'src/baz.ts',
      startLine: 10,
      endLine: 10,
      severity: 'WARNING',
      category: 'perf',
      title: 'F4 accepted',
      rationale: 'test',
      confidence: 0.8,
      kind: 'finding',
      acceptedAt: new Date('2024-06-12T13:00:00.000Z'),
      dismissedAt: null,
    });

    // ---- Workspace B for IDOR test (AC-12) ----
    const [wsB] = await db
      .insert(t.workspaces)
      .values({ name: 'workspace-b-isolation-test' })
      .returning();
    wsBId = wsB!.id;

    const [agentWsB] = await db
      .insert(t.agents)
      .values({
        workspaceId: wsBId,
        name: 'WsB Private Agent',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'Private agent in workspace B.',
      })
      .returning();
    agentWsBId = agentWsB!.id;
  });

  afterAll(async () => {
    // Cascade delete from workspaces removes all workspace-scoped rows
    if (workspaceId) {
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, workspaceId));
    }
    if (wsBId) {
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, wsBId));
    }
    await pg?.stop();
  });

  // ---------------------------------------------------------------------------
  // AC-1: GET /agents/performance and GET /agents/:id/stats agree field-for-field
  // ---------------------------------------------------------------------------

  it('AC-1: performance row and stats response agree on runs, avg_cost_usd, avg_latency_ms, accept_rate for the same agent', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      // GET /agents/performance — workspace-wide dashboard
      const perfRes = await app.inject({
        method: 'GET',
        url: `/agents/performance?${PERIOD_QUERY}`,
      });
      expect(perfRes.statusCode, `GET /agents/performance returned ${perfRes.statusCode}: ${perfRes.body}`).toBe(200);

      const perfBody = perfRes.json<{
        summary: {
          runs: number;
          total_cost_usd: number | null;
          avg_accept_rate: number | null;
          most_active_agent: string | null;
        };
        agents: Array<{
          agent_id: string;
          runs: number;
          avg_cost_usd: number | null;
          avg_latency_ms: number | null;
          accept_rate: number | null;
          trend: number[];
        }>;
        cost_by_agent: Array<{ label: string; value: number }>;
        cost_by_model: Array<{ label: string; value: number }>;
      }>();

      // Find Agent Alpha's row in the dashboard
      const alphaRow = perfBody.agents.find((a) => a.agent_id === agentAlphaId);
      expect(alphaRow).toBeDefined();

      // GET /agents/:id/stats — per-agent detail
      const statsRes = await app.inject({
        method: 'GET',
        url: `/agents/${agentAlphaId}/stats?${PERIOD_QUERY}`,
      });
      expect(statsRes.statusCode).toBe(200);

      const statsBody = statsRes.json<{
        runs: number;
        avg_cost_usd: number | null;
        avg_latency_ms: number | null;
        accept_rate: number | null;
        trend: Array<{ label: string; value: number }>;
      }>();

      // ---- AC-1: field-by-field equality ----
      // runs: A1 + A2 are done in window (A3 is failed, A_out is outside)
      expect(statsBody.runs).toBe(2);
      expect(alphaRow!.runs).toBe(statsBody.runs);

      // avg_cost_usd: only A1 is priced (1.5), A2 is null-cost → AVG(1.5) = 1.5
      expect(statsBody.avg_cost_usd).toBeCloseTo(1.5, 10);
      expect(alphaRow!.avg_cost_usd).toBeCloseTo(statsBody.avg_cost_usd!, 10);

      // avg_latency_ms: (100+200)/2 = 150
      expect(statsBody.avg_latency_ms).toBeCloseTo(150, 10);
      expect(alphaRow!.avg_latency_ms).toBeCloseTo(statsBody.avg_latency_ms!, 10);

      // accept_rate: 1 accepted, 1 dismissed → 1/(1+1) = 0.5
      expect(statsBody.accept_rate).toBeCloseTo(0.5, 10);
      expect(alphaRow!.accept_rate).toBeCloseTo(statsBody.accept_rate!, 10);
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC-13a: Trend agreement — dashboard trend numbers == stats trend values
  // ---------------------------------------------------------------------------

  it('AC-13a: dashboard trend[] values equal stats trend StatPoint[] values for same agent+window', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      const perfRes = await app.inject({
        method: 'GET',
        url: `/agents/performance?${PERIOD_QUERY}`,
      });
      const perfBody = perfRes.json<{
        agents: Array<{ agent_id: string; trend: number[] }>;
      }>();
      const alphaPerf = perfBody.agents.find((a) => a.agent_id === agentAlphaId);
      expect(alphaPerf).toBeDefined();

      const statsRes = await app.inject({
        method: 'GET',
        url: `/agents/${agentAlphaId}/stats?${PERIOD_QUERY}`,
      });
      const statsBody = statsRes.json<{
        trend: Array<{ label: string; value: number }>;
      }>();

      // Both sides represent the same underlying series from recentRunSeries().
      // Dashboard: number[] (raw findingsCount)
      // Stats: StatPoint[] ({ label: ranAt ISO, value: findingsCount })
      // The values must be equal element-by-element.
      const statsValues = statsBody.trend.map((p) => p.value);
      expect(alphaPerf!.trend).toEqual(statsValues);

      // Also verify the trend content for Alpha.
      // recentRunSeries() is NOT window-scoped — it returns the last N done runs
      // globally. A_out (2024-01-01, findingsCount=99) is outside the custom
      // period but is still a done run and sorts oldest-first:
      //   A_out (2024-01-01, fc=99) < A1 (2024-06-10, fc=2) < A2 (2024-06-20, fc=3)
      // → [99, 2, 3]
      expect(alphaPerf!.trend).toEqual([99, 2, 3]);
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC-12: Workspace isolation — no IDOR
  // ---------------------------------------------------------------------------

  it('AC-12: GET /agents/:id/stats with workspace-B agent id returns 404 (workspace A context, no B data leaked)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      // The app uses workspace A (LocalNoAuthProvider → "default" workspace).
      // agentWsBId belongs to workspace B.
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agentWsBId}/stats?period=30d`,
      });

      expect(res.statusCode).toBe(404);

      // Verify the error envelope is clean — no workspace-B data leaked
      const body = res.json<{
        error?: { code?: string; message?: string };
        agent_name?: unknown;
        agent_id?: unknown;
        runs?: unknown;
      }>();

      // Error envelope present
      expect(body.error).toBeDefined();
      expect(body.error!.code).toBe('not_found');

      // The error message must NOT contain workspace-B agent's name
      expect(body.error!.message).not.toContain('WsB Private Agent');
      expect(body.error!.message).not.toContain(wsBId);

      // No stats fields in the body
      expect(body.agent_name).toBeUndefined();
      expect(body.runs).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC-15: No LLM provider or run-executor dependency
  // ---------------------------------------------------------------------------

  it('AC-15: agent-performance module contains no LLMProvider or run-executor imports (static grep)', () => {
    // Grep for actual import/require/from statements only — not comments that
    // mention the forbidden symbols (service.ts has a comment saying "MUST NOT
    // import LLMProvider" which should not trip this check).
    // Pattern: lines starting with optional whitespace then 'import' or
    // 'require(' that also contain the forbidden symbols.
    let grepOutput = '';
    let grepError = false;
    try {
      grepOutput = execSync(
        String.raw`grep -rn "^\s*import.*\(LLMProvider\|run-executor\|runExecutor\)\|require.*\(LLMProvider\|run-executor\|runExecutor\)" server/src/modules/agent-performance/`,
        { encoding: 'utf8', cwd: '/Users/helga/Sites/neoversity/dev-digest/dev-digest' },
      );
    } catch {
      // grep exits 1 when no matches found — that's the success case for this test
      grepError = true;
    }

    if (!grepError) {
      // grep found actual import lines — fail with diagnostic output
      throw new Error(
        `agent-performance module imports LLMProvider or run-executor:\n${grepOutput}`,
      );
    }
    // grep returned exit code 1 (no import matches) → the module is LLM-free ✓
  });

  // ---------------------------------------------------------------------------
  // Summary invariants (cross-check workspace-wide totals)
  // ---------------------------------------------------------------------------

  it('workspace summary: total_cost_usd = sum of agent costs (AC-2 via real Postgres)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/performance?${PERIOD_QUERY}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{
        summary: { total_cost_usd: number | null };
        cost_by_agent: Array<{ label: string; value: number }>;
        cost_by_model: Array<{ label: string; value: number }>;
      }>();

      // Both test agents have priced runs (alpha=1.5, beta=2.5); seeded demo
      // agents have no runs so they don't contribute.
      const sumByAgent = body.cost_by_agent.reduce((s, c) => s + c.value, 0);
      const sumByModel = body.cost_by_model.reduce((s, c) => s + c.value, 0);

      expect(body.summary.total_cost_usd).not.toBeNull();
      // summary.total_cost_usd ≥ 4.0 (our two agents; seed may have priced runs too)
      // Use ≥ because the seed PR's demo review has no agent_runs linked → cost=null
      expect(body.summary.total_cost_usd!).toBeGreaterThanOrEqual(4.0);
      // The three-way invariant
      expect(sumByAgent).toBeCloseTo(body.summary.total_cost_usd!, 10);
      expect(sumByModel).toBeCloseTo(body.summary.total_cost_usd!, 10);
    } finally {
      await app.close();
    }
  });

  it('non-done runs and out-of-window runs are excluded from aggregates', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      // Use the exact test window; the outside run (2024-01-01) must not appear
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agentAlphaId}/stats?${PERIOD_QUERY}`,
      });
      const body = res.json<{ runs: number; avg_cost_usd: number | null }>();

      // Only A1 and A2 are done-in-window; A3 is failed; A_out is out-of-window
      expect(body.runs).toBe(2);
      // A_out's costUsd=999 must not contaminate avg_cost_usd
      // avg_cost_usd = AVG(1.5) = 1.5 (only A1 has a price)
      expect(body.avg_cost_usd).toBeCloseTo(1.5, 10);
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Zero-run placeholder branch: agent with no in-window runs but all-time run
  // ---------------------------------------------------------------------------

  it('zero-run placeholder: agent with no done runs in window but a pre-window done run → runs=0 and last_run_at from all-time history (not null)', async () => {
    // Agent Gamma has exactly one done run: 2024-01-15, which is BEFORE the
    // query window 2024-06-01..2024-06-30.
    //
    // In service.aggregate() this hits the zero-run placeholder branch (path 2):
    //   - aggregateAgents() returns no row for Gamma (no in-window done runs)
    //   - allTimeLastRunAt() returns 2024-01-15 for Gamma
    //   → the placeholder literal must set lastRunAt from the Map, not null.
    //
    // Regression target: a refactor that forgets `lastRunAt` in the literal
    // would make last_run_at null — which this test catches at real-Postgres
    // resolution, where neither tsc nor a mocked-repo unit test would catch it.
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/performance?${PERIOD_QUERY}`,
      });
      expect(res.statusCode, `GET /agents/performance returned ${res.statusCode}: ${res.body}`).toBe(200);

      const body = res.json<{
        agents: Array<{
          agent_id: string;
          runs: number;
          last_run_at: string | null;
        }>;
      }>();

      const gammaRow = body.agents.find((a) => a.agent_id === agentGammaId);
      expect(gammaRow, 'Agent Gamma must appear in the response').toBeDefined();

      // Gamma has ZERO done runs inside the window → the placeholder branch ran
      expect(gammaRow!.runs).toBe(0);

      // Gamma's pre-window done run (2024-01-15) must surface via allTimeLastRunAt,
      // NOT be null just because it falls outside the selected window
      expect(gammaRow!.last_run_at).not.toBeNull();
      expect(gammaRow!.last_run_at).toBe('2024-01-15T12:00:00.000Z');
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // last_run_at is NOT window-scoped (the fix this test was added for)
  // ---------------------------------------------------------------------------

  it('last_run_at reflects all-time most-recent done run, NOT limited to the selected window', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      // Narrow window: 2024-06-01..2024-06-15.
      // Alpha's done runs visible in this window: A1 (2024-06-10) only.
      // Alpha's all-time most-recent done run: A2 (2024-06-20), OUTSIDE this window.
      //
      // Pre-fix (windowed MAX in aggregateAgents): last_run_at would be
      //   '2024-06-10T12:00:00.000Z' (A1, the latest run within the narrow window).
      // Post-fix (allTimeLastRunAt — unwindowed): last_run_at must be
      //   '2024-06-20T12:00:00.000Z' (A2, the true all-time most-recent done run).
      const narrowQuery = 'period=custom&from=2024-06-01&to=2024-06-15';

      const perfRes = await app.inject({
        method: 'GET',
        url: `/agents/performance?${narrowQuery}`,
      });
      expect(perfRes.statusCode, `GET /agents/performance returned ${perfRes.statusCode}: ${perfRes.body}`).toBe(200);

      const perfBody = perfRes.json<{
        agents: Array<{
          agent_id: string;
          last_run_at: string | null;
        }>;
      }>();

      const alphaRow = perfBody.agents.find((a) => a.agent_id === agentAlphaId);
      expect(alphaRow, 'Agent Alpha must appear in the response').toBeDefined();

      // A2 ran on 2024-06-20 — outside the narrow window (ends 2024-06-15) but
      // is the all-time most-recent done run for Alpha. The fix must surface it.
      expect(alphaRow!.last_run_at).toBe('2024-06-20T12:00:00.000Z');
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Finding 3: OFFSET/pagination correctness — disjoint pages, consistent total,
  // ran_at DESC ordering across pages
  // ---------------------------------------------------------------------------

  describe('GET /agents/:id/runs — pagination offset/page disjointness', () => {
    let paginationAgentId: string;
    // Capture run IDs in seeding order (newest → oldest: P4, P3, P2, P1)
    let runP1Id: string;
    let runP2Id: string;
    let runP3Id: string;
    let runP4Id: string;

    beforeAll(async () => {
      // Seed a dedicated agent + 4 in-window runs so that limit=2 produces 2 full pages.
      // Using the shared `workspaceId` and `pg.handle.db` from the outer beforeAll.
      const db = pg.handle.db;

      const [paginationAgent] = await db
        .insert(t.agents)
        .values({
          workspaceId,
          name: 'IT Agent Pagination',
          provider: 'openai',
          model: 'gpt-4o',
          systemPrompt: 'Dedicated pagination test agent.',
        })
        .returning();
      paginationAgentId = paginationAgent!.id;

      // P1 (oldest), P2, P3, P4 (newest) — all done, in-window, different ranAt
      const [rP1] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: paginationAgentId,
          status: 'done',
          ranAt: new Date('2024-06-05T08:00:00.000Z'),
          findingsCount: 1,
        })
        .returning();
      runP1Id = rP1!.id;

      const [rP2] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: paginationAgentId,
          status: 'done',
          ranAt: new Date('2024-06-10T08:00:00.000Z'),
          findingsCount: 2,
        })
        .returning();
      runP2Id = rP2!.id;

      const [rP3] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: paginationAgentId,
          status: 'failed',
          ranAt: new Date('2024-06-15T08:00:00.000Z'),
          findingsCount: 3,
        })
        .returning();
      runP3Id = rP3!.id;

      const [rP4] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: paginationAgentId,
          status: 'done',
          ranAt: new Date('2024-06-20T08:00:00.000Z'),
          findingsCount: 4,
        })
        .returning();
      runP4Id = rP4!.id;
    });

    it('pages are disjoint (no run appears on both pages), total is identical across pages, combined rows are ordered ran_at DESC', async () => {
      // runHistory includes ALL statuses — 4 rows in window (P1..P4).
      // limit=2 → page 1: P4 + P3 (newest); page 2: P2 + P1 (oldest).
      const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
      const app = await buildApp({ config, db: pg.handle.db });

      try {
        const page1Res = await app.inject({
          method: 'GET',
          url: `/agents/${paginationAgentId}/runs?${PERIOD_QUERY}&limit=2&page=1`,
        });
        expect(
          page1Res.statusCode,
          `page 1 returned ${page1Res.statusCode}: ${page1Res.body}`,
        ).toBe(200);

        const page2Res = await app.inject({
          method: 'GET',
          url: `/agents/${paginationAgentId}/runs?${PERIOD_QUERY}&limit=2&page=2`,
        });
        expect(
          page2Res.statusCode,
          `page 2 returned ${page2Res.statusCode}: ${page2Res.body}`,
        ).toBe(200);

        const p1 = page1Res.json<{
          rows: Array<{ run_id: string; ran_at: string }>;
          total: number;
          page: number;
          limit: number;
        }>();
        const p2 = page2Res.json<{
          rows: Array<{ run_id: string; ran_at: string }>;
          total: number;
          page: number;
          limit: number;
        }>();

        // total is 4 across all 4 seeded runs — must be identical on both pages
        expect(p1.total).toBe(4);
        expect(p2.total).toBe(4);

        // Both pages must return exactly 2 rows (page 1 is full; page 2 is also full)
        expect(p1.rows).toHaveLength(2);
        expect(p2.rows).toHaveLength(2);

        // Disjointness: no run_id appears on both pages
        const p1Ids = new Set(p1.rows.map((r) => r.run_id));
        const p2Ids = new Set(p2.rows.map((r) => r.run_id));
        for (const id of p2Ids) {
          expect(p1Ids.has(id)).toBe(false);
        }

        // No row is skipped: union of both pages = all 4 seeded run IDs
        const allSeededIds = new Set([runP1Id, runP2Id, runP3Id, runP4Id]);
        const unionIds = new Set([...p1Ids, ...p2Ids]);
        expect(unionIds.size).toBe(4);
        for (const id of allSeededIds) {
          expect(unionIds.has(id)).toBe(true);
        }

        // Combined order is ran_at DESC end-to-end:
        // page 1 holds the 2 newest (P4 then P3), page 2 holds P2 then P1.
        const combinedRows = [...p1.rows, ...p2.rows];
        expect(combinedRows[0]!.run_id).toBe(runP4Id);
        expect(combinedRows[1]!.run_id).toBe(runP3Id);
        expect(combinedRows[2]!.run_id).toBe(runP2Id);
        expect(combinedRows[3]!.run_id).toBe(runP1Id);

        // Verify monotone descent: each ran_at <= the previous
        for (let i = 1; i < combinedRows.length; i++) {
          const prev = new Date(combinedRows[i - 1]!.ran_at).getTime();
          const curr = new Date(combinedRows[i]!.ran_at).getTime();
          expect(curr).toBeLessThanOrEqual(prev);
        }
      } finally {
        await app.close();
      }
    });
  });

  it('array-binding (ARRAY[...]::uuid[]) works against real Postgres for recentRunSeries', async () => {
    // This test validates the INSIGHTS 2026-07-16 postgres-js fix implicitly:
    // recentRunSeries() is called with [agentAlphaId, agentBetaId] when the
    // performance endpoint runs. If the ARRAY binding regressed to ANY($1),
    // the query would throw PostgresError code 42809 and the endpoint would
    // return a 500 or an empty trend array.
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/performance?${PERIOD_QUERY}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json<{
        agents: Array<{ agent_id: string; trend: number[] }>;
      }>();

      // Both test agents must have non-empty trend arrays — proves recentRunSeries
      // returned data (array binding succeeded against real Postgres)
      const alphaRow = body.agents.find((a) => a.agent_id === agentAlphaId);
      const betaRow = body.agents.find((a) => a.agent_id === agentBetaId);

      expect(alphaRow).toBeDefined();
      expect(betaRow).toBeDefined();
      expect(alphaRow!.trend.length).toBeGreaterThan(0);
      expect(betaRow!.trend.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // GET /agents/:id/runs — has_trace gate and window-scoping (Finding 1 coverage)
  // ---------------------------------------------------------------------------

  it('GET /agents/:id/runs: has_trace=true for run with a run_traces row, has_trace=false without; out-of-window run excluded', async () => {
    // Seeded state for Agent Alpha:
    //   A1  2024-06-10  done    → run_traces row seeded → has_trace: true
    //   A2  2024-06-20  done    → no run_traces row     → has_trace: false
    //   A3  2024-06-25  failed  → no run_traces row     → has_trace: false
    //   A_out 2024-01-01 done   → OUTSIDE PERIOD_QUERY window → must be excluded
    //
    // runHistory() includes ALL statuses (AC-8/AC-10), orders newest first.
    // Window filter is applied by ranAt >= fromTs AND ranAt <= toTs.
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agentAlphaId}/runs?${PERIOD_QUERY}`,
      });
      expect(
        res.statusCode,
        `GET /agents/:id/runs returned ${res.statusCode}: ${res.body}`,
      ).toBe(200);

      const body = res.json<{
        rows: Array<{ run_id: string; ran_at: string; has_trace: boolean; status: string | null }>;
        total: number;
        page: number;
        limit: number;
      }>();

      // Window-scoping: A_out (2024-01-01) must NOT appear in the in-window response.
      // Only A1, A2, A3 are inside 2024-06-01..2024-06-30 → total = 3.
      expect(body.total).toBe(3);
      expect(body.rows).toHaveLength(3);

      const outOfWindowRow = body.rows.find((r) => r.ran_at.startsWith('2024-01'));
      expect(
        outOfWindowRow,
        'A_out (2024-01-01) must be excluded by the window ranAt filter',
      ).toBeUndefined();

      // has_trace gate: A1 has a run_traces row seeded → has_trace: true
      const rowA1 = body.rows.find((r) => r.run_id === runA1Id);
      expect(rowA1, 'A1 run must appear in the in-window response').toBeDefined();
      expect(rowA1!.has_trace).toBe(true);

      // has_trace gate: A2 has NO run_traces row → has_trace: false
      const rowA2 = body.rows.find((r) => r.run_id === runA2Id);
      expect(rowA2, 'A2 run must appear in the in-window response').toBeDefined();
      expect(rowA2!.has_trace).toBe(false);
    } finally {
      await app.close();
    }
  });
});
