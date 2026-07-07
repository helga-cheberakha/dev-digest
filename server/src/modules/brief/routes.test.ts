/**
 * routes.test.ts — HTTP-layer integration tests for brief routes (T14).
 *
 * Covers: AC-1 (200 + Brief), AC-6 (cached second POST → 0 new LLM calls),
 * AC-9 (5xx `{ error }` body, no stack trace leaked), AC-17 (ii) — the REAL
 * `pg_advisory_xact_lock` half (B2), gated on a real `DATABASE_URL`.
 *
 * Oracle: each assertion is derived from the AC's observable HTTP behaviour in
 * SPEC-2026-07-07-why-risk-brief.md / PLAN-why-risk-brief.md T14.
 *
 * Pattern (server/INSIGHTS.md 2026-07-05 no-DB smoke):
 *   – `buildApp({ config, db: mockDb, overrides: { auth, llm } })` — routes.ts
 *     constructs its OWN `BriefRepository(container.db)`, so the real
 *     `withPrLock` (→ `db.transaction` + `pg_advisory_xact_lock`) runs; the
 *     mock db's `.transaction()` just invokes the callback directly (no real
 *     locking) and `.execute()` is a no-op — sufficient for the single-request
 *     (non-concurrent) AC-1/AC-6/AC-9 smoke tests below.
 *   – The mock CANNOT exercise the real advisory lock (server/INSIGHTS.md
 *     2026-07-05 + this task's Known gotchas), so AC-17's true concurrency
 *     guarantee is asserted ONLY by the `describe.skipIf(!process.env.DATABASE_URL)`
 *     suite at the bottom, which fires a genuine concurrent POST pair through a
 *     real Postgres connection (B2). The mock-db ORCHESTRATION half of AC-17
 *     lives in `service.test.ts` (an injected `withPrLock` stub).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createDb, type DbHandle } from '../../db/client.js';
import { MockAuthProvider, MockGitHubClient, MockLLMProvider } from '../../adapters/mocks.js';
import type { RepoIntel } from '../repo-intel/types.js';
import type { Db } from '../../db/client.js';
import type { Brief } from '@devdigest/shared';
import * as t from '../../db/schema.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const PR_ID = '00000000-0000-0000-0000-000000000001';

/** Empty risks/review_focus trivially survive grounding (no file_refs). */
const validBrief: Brief = {
  what: 'Adds rate limiting to the public API',
  why: 'Prevents abuse of unauthenticated endpoints',
  risk_level: 'low',
  risks: [],
  review_focus: [],
};

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ─── Mock db (no-DB smoke tests) ───────────────────────────────────────────

interface DbState {
  pull: { id: string; repoId: string; number: number; headSha: string } | null;
  brief: { prId: string; json: Brief; headSha: string | null } | null;
}

/**
 * Table-identity mock db, extended (vs. the blast-route precedent) with
 * `.transaction()` and `.execute()` so the real `BriefRepository.withPrLock`
 * (constructed directly by `routes.ts`) can run against it — `.transaction`
 * simply invokes its callback with this same mock db (no real locking), and
 * `.execute()` (the `pg_advisory_xact_lock` statement) is a no-op.
 */
function makeMockDb(state: DbState): Db {
  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: async (_cond?: unknown): Promise<unknown[]> => {
          if (table === t.pullRequests) return state.pull ? [state.pull] : [];
          if (table === t.prBrief) return state.brief ? [state.brief] : [];
          return [];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: { prId: string; json: Brief; headSha: string }) => ({
        onConflictDoUpdate: async (): Promise<void> => {
          if (table === t.prBrief) {
            state.brief = { prId: values.prId, json: values.json, headSha: values.headSha };
          }
        },
      }),
    }),
    execute: async (_fragment: unknown): Promise<unknown> => undefined,
    transaction: async (fn: (tx: Db) => Promise<unknown>): Promise<unknown> =>
      fn(db as unknown as Db),
  };
  return db as unknown as Db;
}

function makeState(headSha = 'sha-abc123'): DbState {
  return {
    pull: { id: PR_ID, repoId: '00000000-0000-0000-0000-000000000002', number: 42, headSha },
    brief: null,
  };
}

// ─── AC-1 (via route): fresh POST → 200 + Brief-shaped body ────────────────

describe('AC-1 (via route): POST /pulls/:id/brief → 200 with a valid Brief body', () => {
  it('cache-miss POST returns 200 with what/why/risk_level/risks/review_focus', async () => {
    const state = makeState();
    const llm = new MockLLMProvider('openai', { structured: validBrief });
    const app = await buildApp({
      config: config(),
      db: makeMockDb(state),
      overrides: { auth: new MockAuthProvider(), llm: { openai: llm } },
    });

    try {
      const res = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief`, payload: {} });

      expect(res.statusCode).toBe(200);
      const body = res.json<Brief>();
      expect(body.what).toBeTruthy();
      expect(body.why).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(body.risk_level);
      expect(Array.isArray(body.risks)).toBe(true);
      expect(Array.isArray(body.review_focus)).toBe(true);

      const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
      expect(structuredCalls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('POST for a PR that does not exist in the current workspace → 404', async () => {
    const app = await buildApp({
      config: config(),
      db: makeMockDb({ pull: null, brief: null }),
      overrides: { auth: new MockAuthProvider() },
    });

    try {
      const res = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief`, payload: {} });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

// ─── AC-6 (via route): cached second POST → 0 new LLM calls ───────────────

describe('AC-6 (via route): unchanged head_sha + no force → second POST is a cache hit', () => {
  it('two POSTs at the same head_sha make exactly one completeStructured call total', async () => {
    const state = makeState();
    const llm = new MockLLMProvider('openai', { structured: validBrief });
    const app = await buildApp({
      config: config(),
      db: makeMockDb(state),
      overrides: { auth: new MockAuthProvider(), llm: { openai: llm } },
    });

    try {
      const first = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief`, payload: {} });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief`, payload: {} });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());

      const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
      expect(structuredCalls).toHaveLength(1); // no new call on the cached second POST
    } finally {
      await app.close();
    }
  });
});

// ─── AC-9 (via route): forced LLM failure → 5xx { error }, no stack trace ──

describe('AC-9 (via route): LLM failure → 5xx { error } body with no stack trace', () => {
  it('a throwing LLM provider → 502 with { error: { code, message } } and no `stack` key', async () => {
    const state = makeState();
    const llm = new MockLLMProvider('openai', { structured: validBrief });
    llm.completeStructured = async () => {
      llm.calls.push({ method: 'completeStructured', req: null });
      throw new Error('upstream boom');
    };
    const app = await buildApp({
      config: config(),
      db: makeMockDb(state),
      overrides: { auth: new MockAuthProvider(), llm: { openai: llm } },
    });

    try {
      const res = await app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief`, payload: {} });

      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(res.statusCode).toBeLessThan(600);

      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('external_service_error');
      expect(typeof body.error.message).toBe('string');
      // AC-9 observable: no stack trace leaks into the response body.
      expect(body).not.toHaveProperty('stack');
      expect(body.error).not.toHaveProperty('stack');
      expect(res.body).not.toContain('at BriefService');

      // Cache must be untouched by the failed attempt.
      expect(state.brief).toBeNull();
    } finally {
      await app.close();
    }
  });
});

// ─── AC-17 (ii): real-Postgres concurrent POST pair → 1 LLM call (B2) ──────

/**
 * The mock db above cannot exercise the real `pg_advisory_xact_lock` (it has
 * no true cross-request serialization). This suite is the ONLY true AC-17
 * gate: it fires a genuine concurrent POST pair through a real Postgres
 * connection and asserts the advisory lock serializes them to a single LLM
 * call. Gated on `process.env.DATABASE_URL` (present in CI, e.g. the e2e
 * workflow's fresh DB); skipped cleanly otherwise.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'AC-17 (ii): real-Postgres concurrent POST pair → exactly one LLM call (B2)',
  () => {
    let handle: DbHandle;
    let workspaceId: string;

    beforeAll(async () => {
      handle = createDb(process.env.DATABASE_URL!, { max: 5 });
      const [ws] = await handle.db
        .insert(t.workspaces)
        .values({ name: `brief-it-${randomUUID()}` })
        .returning();
      workspaceId = ws!.id;
    });

    afterAll(async () => {
      if (workspaceId) {
        // Cascades to repos → pull_requests → pr_brief (all FK onDelete: cascade).
        await handle.db.delete(t.workspaces).where(eq(t.workspaces.id, workspaceId));
      }
      await handle?.close();
    });

    /** Full RepoIntel mock — implements every method (required by tsc). */
    function makeMockRepoIntel(): RepoIntel {
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
      };
    }

    it('two concurrent POSTs for the same PR → completeStructured called exactly once, identical Briefs', async () => {
      const [repo] = await handle.db
        .insert(t.repos)
        .values({
          workspaceId,
          owner: 'brief-it',
          name: `repo-${randomUUID()}`,
          fullName: `brief-it/repo-${randomUUID()}`,
        })
        .returning();
      const [pr] = await handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: repo!.id,
          number: 1,
          title: 'Concurrent brief test',
          author: 'tester',
          branch: 'feat/concurrent-brief',
          base: 'main',
          headSha: 'concurrent-sha-1',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'open',
        })
        .returning();

      const llm = new MockLLMProvider('openai', { structured: validBrief });
      const app = await buildApp({
        config: config(),
        db: handle.db,
        overrides: {
          auth: new MockAuthProvider(undefined, { id: workspaceId, name: 'brief-it' }),
          github: new MockGitHubClient(),
          repoIntel: makeMockRepoIntel(),
          llm: { openai: llm },
        },
      });

      try {
        const [res1, res2] = await Promise.all([
          app.inject({ method: 'POST', url: `/pulls/${pr!.id}/brief`, payload: {} }),
          app.inject({ method: 'POST', url: `/pulls/${pr!.id}/brief`, payload: {} }),
        ]);

        expect(res1.statusCode).toBe(200);
        expect(res2.statusCode).toBe(200);
        expect(res1.json()).toEqual(res2.json());

        const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
        expect(structuredCalls).toHaveLength(1);
      } finally {
        await app.close();
      }
    });
  },
);
