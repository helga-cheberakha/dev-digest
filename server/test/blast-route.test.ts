import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { Db } from '../src/db/client.js';

/**
 * No-DB blast route smoke tests.
 *
 * The blast route needs to query the `pull_requests` table to look up the PR.
 * We provide a minimal mock DB whose `select().from().where()` always resolves
 * to `[]` (no rows), so the route throws `NotFoundError` → 404 without
 * needing a real Postgres connection.
 *
 * Auth is injected via `MockAuthProvider` so workspace resolution also skips
 * the DB.
 */

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Minimal Drizzle-compatible mock DB.
 *
 * The blast route does exactly one DB operation: a `select().from().where()`
 * that returns a row array. Returning `[]` causes the "PR not found" 404.
 *
 * `reapStaleRuns` (called during `buildApp`) uses `db.update()` — that method
 * is intentionally omitted so it throws; `buildApp` wraps it in a non-fatal
 * try/catch and continues.
 */
const mockDb = {
  select: (_fields?: unknown) => ({
    from: (_table: unknown) => ({
      where: async (_cond?: unknown): Promise<never[]> => [],
    }),
  }),
} as unknown as Db;

/** Minimal RepoIntel stub — implements every method on the interface. */
const mockRepoIntel: RepoIntel = {
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

describe('blast route (no DB)', () => {
  it('GET /pulls/<valid-uuid>/blast with non-existent PR → 404', async () => {
    const app = await buildApp({
      config,
      db: mockDb,
      overrides: {
        auth: new MockAuthProvider(),
        repoIntel: mockRepoIntel,
      },
    });
    // Any valid UUID — the mock DB returns [] so the PR is never found.
    const uuid = '00000000-0000-0000-0000-000000000001';
    const res = await app.inject({ method: 'GET', url: `/pulls/${uuid}/blast` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /health → 200 after blast module registration', async () => {
    const app = await buildApp({
      config,
      db: mockDb,
      overrides: { auth: new MockAuthProvider() },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
