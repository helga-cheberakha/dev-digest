/**
 * Contract tests for the Intent Layer's `risk_areas` removal (AC-16, T7):
 *
 *  1. `GET /pulls/:id/intent` no longer returns `risk_areas` in its response
 *     body (the field + its DB column were removed in T2/T7).
 *  2. The shared `Risk` contract now narrows `kind` to the `RiskAreaKind`
 *     enum — a `Risk` with an out-of-enum `kind` must fail `Risk.parse()`.
 *
 * The route test follows the no-DB smoke pattern (`server/INSIGHTS.md`
 * 2026-07-05): a minimal mock `db` injected via `buildApp({ db })`, auth
 * bypassed by `MockAuthProvider` (no DB call for GET /intent's `getContext`).
 */
import { describe, it, expect } from 'vitest';
import { Risk, RiskAreaKind } from '@devdigest/shared';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider } from '../../adapters/mocks.js';
import type { Db } from '../../db/client.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PR_ID = '00000000-0000-0000-0000-000000000001';

/** A stored `pr_intent` row shaped like the current schema (no `riskAreas`
 *  column — dropped in migration T2). */
const INTENT_ROW = {
  prId: PR_ID,
  summary: 'Adds a caching layer to the pull list endpoint.',
  inScope: ['Add Redis cache', 'Invalidate on write'],
  outOfScope: ['Rate limiting'],
  model: 'openai/gpt-4o-mini',
  tokensSaved: 120,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
};

/** Minimal Drizzle-compatible mock DB — `IntentRepository.findByPrId` does
 *  exactly one `select().from().where()` and expects a row array back. */
const mockDb = {
  select: (_fields?: unknown) => ({
    from: (_table: unknown) => ({
      where: async (_cond?: unknown) => [INTENT_ROW],
    }),
  }),
} as unknown as Db;

describe('GET /pulls/:id/intent contract (AC-16)', () => {
  it('response body contains no risk_areas field', async () => {
    const app = await buildApp({
      config,
      db: mockDb,
      overrides: { auth: new MockAuthProvider() },
    });
    try {
      const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/intent` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).not.toHaveProperty('risk_areas');
      expect(Object.keys(body).sort()).toEqual(
        ['in_scope', 'out_of_scope', 'pr_id', 'summary'].sort(),
      );
      expect(body).toEqual({
        pr_id: PR_ID,
        summary: INTENT_ROW.summary,
        in_scope: INTENT_ROW.inScope,
        out_of_scope: INTENT_ROW.outOfScope,
      });
    } finally {
      await app.close();
    }
  });
});

describe('Risk contract — kind narrowed to RiskAreaKind (AC-16)', () => {
  const base = {
    title: 'Broad DB permissions',
    explanation: 'The new role grants write access beyond what this PR needs.',
    severity: 'high' as const,
    file_refs: ['src/db/schema.ts'],
  };

  it('Risk.parse() fails for an out-of-enum kind', () => {
    const invalid = { ...base, kind: 'not-a-real-kind' };
    expect(() => Risk.parse(invalid)).toThrow();
  });

  it('Risk.parse() succeeds for every valid RiskAreaKind value', () => {
    for (const kind of RiskAreaKind.options) {
      expect(() => Risk.parse({ ...base, kind })).not.toThrow();
    }
  });
});
