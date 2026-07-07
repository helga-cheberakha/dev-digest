/**
 * service.test.ts — Integration tests for BriefService (T14).
 *
 * Covers: AC-1, AC-6, AC-7, AC-8, AC-9, AC-17 (mock-db ORCHESTRATION half —
 * the real `pg_advisory_xact_lock` half is exercised separately by
 * routes.test.ts's `describe.skipIf(!process.env.DATABASE_URL)` suite, B2),
 * m5.
 *
 * Oracle: each assertion is derived from the AC's observable behaviour in
 * SPEC-2026-07-07-why-risk-brief.md / PLAN-why-risk-brief.md T14, not from
 * reading the implementation.
 *
 * Pattern (server/INSIGHTS.md 2026-07-05 no-DB smoke, adapted from
 * `onboarding/service.test.ts`):
 *   – Minimal table-identity mock `db` (select/insert only — no real Postgres).
 *   – `BriefService` instantiated directly with a real `BriefRepository`
 *     wrapping the mock db, so `.read`/`.currentHead`/`.upsert` run the actual
 *     repository logic against the in-memory store.
 *   – `withPrLock` is the ONE method replaced — with an in-process per-PR FIFO
 *     queue standing in for the real Postgres advisory lock (`repository.ts`'s
 *     `db.transaction` + `pg_advisory_xact_lock` cannot run on a mock db). The
 *     queue's `fn` is invoked with the SAME mock db as `tx`, so the service's
 *     `new BriefRepository(tx)` construction (service.ts step 3) reads/writes
 *     the identical in-memory state as the outer (unlocked-fast-path) repo.
 *   – `MockLLMProvider` with a `.calls` invocation counter for LLM-call-count
 *     assertions (AC-1/AC-6/AC-7/AC-8/AC-17/m5 are all defined in terms of it).
 */

import { describe, it, expect } from 'vitest';
import { BriefService } from './service.js';
import { BriefRepository } from './repository.js';
import type { Brief } from '@devdigest/shared';
import { Brief as BriefSchema } from '@devdigest/shared';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { Container } from '../../platform/container.js';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const PR_ID = '00000000-0000-0000-0000-000000000001';
const WORKSPACE_ID = 'workspace-1';
const REPO_ID = '00000000-0000-0000-0000-000000000002';
const HEAD_SHA = 'sha-abc123';

/** A minimal, always-valid Brief fixture: empty risks/review_focus trivially
 * survive the grounding gate (no file_refs to check against the known-path
 * set), keeping these tests focused on orchestration, not grounding (T13). */
const validBrief: Brief = {
  what: 'Adds rate limiting to the public API',
  why: 'Prevents abuse of unauthenticated endpoints',
  risk_level: 'low',
  risks: [],
  review_focus: [],
};

// ─── In-memory store + mock db ─────────────────────────────────────────────

interface DbState {
  pull: { id: string; repoId: string; number: number; headSha: string } | null;
  brief: { prId: string; json: Brief; headSha: string | null } | null;
}

/**
 * Table-identity mock db (mirrors `onboarding/routes.test.ts`'s pattern):
 * discriminates `pullRequests` vs `prBrief` by object identity, ignores the
 * WHERE clause, and falls through to `[]` for every other table (settings,
 * repos, prFiles, reviews, ... — sufficient for `resolveFeatureModel` and the
 * best-effort blast/smart-diff/linked-issue/specs fact sources, which are all
 * wrapped in try/catch by `gatherFacts` and simply omitted on failure).
 */
function makeMockDb(state: DbState): Db {
  return {
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
  } as unknown as Db;
}

/**
 * A real `BriefRepository` bound to `db`, with `withPrLock` replaced by an
 * in-process per-PR FIFO queue (the ORCHESTRATION half of AC-17). `fn`
 * receives the SAME `db` as `tx`, so the service's `new BriefRepository(tx)`
 * (service.ts, inside the lock) reads/writes the identical in-memory state as
 * `read`/`currentHead` calls made through the outer (unlocked fast-path) repo.
 */
function makeMockRepo(db: Db): BriefRepository {
  const repo = new BriefRepository(db);
  const queues = new Map<string, Promise<unknown>>();
  const stub = (prId: string, fn: (tx: Db) => Promise<unknown>): Promise<unknown> => {
    const prior = queues.get(prId) ?? Promise.resolve();
    const run = prior.then(() => fn(db));
    queues.set(
      prId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };
  repo.withPrLock = stub as BriefRepository['withPrLock'];
  return repo;
}

function makeContainer(opts: { db: Db; llm: MockLLMProvider }): Container {
  return {
    db: opts.db,
    intentRepo: { findByPrId: async () => null },
    llm: async () => opts.llm,
  } as unknown as Container;
}

function makeService(
  opts: {
    headSha?: string;
    initialCache?: { json: Brief; headSha: string | null } | null;
    llm?: MockLLMProvider;
  } = {},
) {
  const llmMock = opts.llm ?? new MockLLMProvider('openai', { structured: validBrief });
  const state: DbState = {
    pull: { id: PR_ID, repoId: REPO_ID, number: 42, headSha: opts.headSha ?? HEAD_SHA },
    brief: opts.initialCache ? { prId: PR_ID, ...opts.initialCache } : null,
  };
  const db = makeMockDb(state);
  const container = makeContainer({ db, llm: llmMock });
  const repo = makeMockRepo(db);
  const service = new BriefService(container, repo);
  return { service, llmMock, state };
}

function structuredCallCount(llm: MockLLMProvider): number {
  return llm.calls.filter((c) => c.method === 'completeStructured').length;
}

// ─── AC-1: fresh generation → 200-shape Brief, exactly one LLM call ────────

describe('AC-1: cache-miss generation returns a valid Brief with exactly one LLM call', () => {
  it('fresh (cache-miss) generation → Brief.parse() succeeds; completeStructured called once', async () => {
    const { service, llmMock } = makeService();

    const result = await service.generateBrief(PR_ID, WORKSPACE_ID);

    expect(() => BriefSchema.parse(result)).not.toThrow();
    expect(structuredCallCount(llmMock)).toBe(1);
  });
});

// ─── AC-6: unchanged head_sha, no force → cached Brief, zero new LLM calls ─

describe('AC-6: unchanged head_sha + no force → cached Brief, no new LLM call', () => {
  it('second call at the same head_sha reuses the cache (LLM count stays at 1)', async () => {
    const { service, llmMock } = makeService();

    const first = await service.generateBrief(PR_ID, WORKSPACE_ID);
    expect(structuredCallCount(llmMock)).toBe(1);

    const second = await service.generateBrief(PR_ID, WORKSPACE_ID);
    expect(structuredCallCount(llmMock)).toBe(1); // no new call
    expect(second).toEqual(first);
  });
});

// ─── AC-7: head_sha change invalidates the cache → regenerate ──────────────

describe('AC-7: head_sha differing from the cached value invalidates the cache', () => {
  it('a head_sha change after a cached generation triggers a fresh LLM call', async () => {
    const { service, llmMock, state } = makeService();

    await service.generateBrief(PR_ID, WORKSPACE_ID);
    expect(structuredCallCount(llmMock)).toBe(1);

    state.pull!.headSha = 'sha-new-456';
    await service.generateBrief(PR_ID, WORKSPACE_ID);
    expect(structuredCallCount(llmMock)).toBe(2);
  });
});

// ─── AC-8: force always regenerates, even on an unchanged head_sha ─────────

describe('AC-8: force=true always yields a fresh LLM call and overwrites the cache', () => {
  it('force=true twice in a row → two fresh LLM calls', async () => {
    const { service, llmMock } = makeService();

    await service.generateBrief(PR_ID, WORKSPACE_ID, { force: true });
    expect(structuredCallCount(llmMock)).toBe(1);

    await service.generateBrief(PR_ID, WORKSPACE_ID, { force: true });
    expect(structuredCallCount(llmMock)).toBe(2);
  });
});

// ─── AC-9: LLM failure / malformed output → deterministic error, cache intact

describe('AC-9: LLM failure or malformed structured output → error thrown, cache unchanged', () => {
  it('AC-9a: a forced LLM error surfaces as ExternalServiceError; cache stays empty', async () => {
    const llmMock = new MockLLMProvider('openai', { structured: validBrief });
    llmMock.completeStructured = async () => {
      llmMock.calls.push({ method: 'completeStructured', req: null });
      throw new Error('upstream boom');
    };
    const { service, state } = makeService({ llm: llmMock });

    await expect(service.generateBrief(PR_ID, WORKSPACE_ID)).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
    });
    expect(state.brief).toBeNull();
  });

  it('AC-9b: malformed structured output (fails Brief.parse() post-grounding) → error, cache unchanged', async () => {
    // Bypass MockLLMProvider's own schema validation so the SERVICE's own
    // re-parse (the trust-boundary re-validation, mirrors intent/service.ts)
    // is what rejects it — `risk_level` is not a member of the enum.
    const llmMock = new MockLLMProvider('openai');
    const malformed = {
      what: 'x',
      why: 'y',
      risk_level: 'NOT_A_LEVEL',
      risks: [],
      review_focus: [],
    } as unknown as Brief;
    llmMock.completeStructured = (async () => {
      llmMock.calls.push({ method: 'completeStructured', req: null });
      return {
        data: malformed,
        model: 'gpt-4.1',
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.0001,
        raw: '{}',
        attempts: 1,
      };
    }) as typeof llmMock.completeStructured;
    const { service, state } = makeService({ llm: llmMock });

    await expect(service.generateBrief(PR_ID, WORKSPACE_ID)).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
    });
    expect(state.brief).toBeNull();
  });
});

// ─── AC-17 (i): mock-db ORCHESTRATION half — concurrent calls serialize ────

describe('AC-17 (i): two concurrent generateBrief calls serialize to a single LLM call (mock-db orchestration)', () => {
  it('Promise.all of two concurrent unforced calls → LLM count = 1, identical Briefs', async () => {
    const { service, llmMock } = makeService();

    const [r1, r2] = await Promise.all([
      service.generateBrief(PR_ID, WORKSPACE_ID),
      service.generateBrief(PR_ID, WORKSPACE_ID),
    ]);

    expect(structuredCallCount(llmMock)).toBe(1);
    expect(r1).toEqual(r2);
  });
});

// ─── m5: a force request queued behind an in-flight generation still calls the LLM itself

describe('m5: a force request queued behind an in-flight generation performs its OWN fresh LLM call', () => {
  it('force is never absorbed by the waiter cache-hit that its predecessor just committed', async () => {
    const llmMock = new MockLLMProvider('openai', { structured: validBrief });

    // Gate the FIRST completeStructured call so the unforced request is
    // demonstrably "in-flight" (inside the lock, mid-generation, not yet
    // committed) when the forced request is started.
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    llmMock.completeStructured = (async () => {
      callCount += 1;
      llmMock.calls.push({ method: 'completeStructured', req: null });
      if (callCount === 1) {
        markStarted();
        await firstGate;
      }
      return {
        data: validBrief,
        model: 'gpt-4.1',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        raw: JSON.stringify(validBrief),
        attempts: 1,
      };
    }) as typeof llmMock.completeStructured;

    const { service } = makeService({ llm: llmMock });

    // Start the unforced request; wait until it has entered the lock,
    // gathered facts, and reached (blocked inside) its LLM call — guaranteeing
    // it registered in the withPrLock queue BEFORE the forced request exists.
    const unforcedPromise = service.generateBrief(PR_ID, WORKSPACE_ID);
    await started;

    // Now start the forced request — it queues BEHIND the still-in-flight
    // unforced generation.
    const forcedPromise = service.generateBrief(PR_ID, WORKSPACE_ID, { force: true });

    // Let the unforced call finish (resolves its LLM call, commits the cache).
    releaseFirst();

    const [unforced, forced] = await Promise.all([unforcedPromise, forcedPromise]);

    // The forced request must have made its OWN fresh LLM call once its turn
    // came, even though the unforced request just committed a fresh cache —
    // never absorbed by the waiter's cache hit.
    expect(callCount).toBe(2);
    expect(BriefSchema.safeParse(unforced).success).toBe(true);
    expect(BriefSchema.safeParse(forced).success).toBe(true);
  });
});
