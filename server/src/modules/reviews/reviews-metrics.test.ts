/**
 * Contract test for AC-11 (T8): `reviewsForPull` surfaces per-review run
 * metrics — a completed `review`-kind `ReviewRecord` must carry non-null
 * `tokens_in`/`tokens_out`/`cost_usd` sourced from its `agent_runs` row via
 * the `run_id` join.
 *
 * Exercises `ReviewService.reviewsForPull` directly (not through Fastify —
 * no route-level concerns here) against a scripted mock `db` whose `select`
 * dispatches on table identity, matching the sequence of queries the
 * service/repository issue: PR lookup → reviews → findings → agent_runs
 * (one `inArray`, per T8's known gotchas / `server/INSIGHTS.md` 2026-06-14
 * per-PR-aggregate pattern).
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../platform/config.js';
import { Container } from '../../platform/container.js';
import { MockAuthProvider } from '../../adapters/mocks.js';
import { ReviewService } from './service.js';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const WORKSPACE_ID = '00000000-0000-0000-0000-00000000000a';
const PR_ID = '00000000-0000-0000-0000-00000000000b';
const RUN_ID = '00000000-0000-0000-0000-00000000000c';
const REVIEW_ID_WITH_RUN = '00000000-0000-0000-0000-00000000000d';
const REVIEW_ID_NO_RUN = '00000000-0000-0000-0000-00000000000e';

const PULL_ROW = { id: PR_ID, workspaceId: WORKSPACE_ID, repoId: 'repo-1' };

/** A completed `review`-kind review whose `run_id` points at a priced run. */
const REVIEW_ROW_WITH_RUN = {
  id: REVIEW_ID_WITH_RUN,
  workspaceId: WORKSPACE_ID,
  prId: PR_ID,
  agentId: null,
  runId: RUN_ID,
  kind: 'review' as const,
  verdict: 'approve',
  summary: 'Looks solid.',
  score: 88,
  model: 'openai/gpt-4o',
  grounding: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

/** A review with no `run_id` at all — metrics must stay null (T8 gotcha:
 *  `ReviewRow.run_id` may be null). */
const REVIEW_ROW_NO_RUN = {
  id: REVIEW_ID_NO_RUN,
  workspaceId: WORKSPACE_ID,
  prId: PR_ID,
  agentId: null,
  runId: null,
  kind: 'review' as const,
  verdict: null,
  summary: null,
  score: null,
  model: null,
  grounding: null,
  createdAt: new Date('2026-07-01T00:05:00Z'),
};

const AGENT_RUN_ROW = {
  id: RUN_ID,
  tokensIn: 1500,
  tokensOut: 320,
  costUsd: 0.0421,
};

function makeMockDb(): Db {
  return {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === t.pullRequests) {
          return { where: async () => [PULL_ROW] };
        }
        if (table === t.reviews) {
          return { where: () => ({ orderBy: async () => [REVIEW_ROW_WITH_RUN, REVIEW_ROW_NO_RUN] }) };
        }
        if (table === t.findings) {
          return { where: async () => [] };
        }
        if (table === t.agentRuns) {
          return { where: async () => [AGENT_RUN_ROW] };
        }
        throw new Error(`reviews-metrics.test: unmocked table select — ${String(table)}`);
      },
    }),
  } as unknown as Db;
}

describe('ReviewService.reviewsForPull — run metrics (AC-11)', () => {
  it('a completed review-kind ReviewRecord carries non-null tokens_in/tokens_out/cost_usd from its agent_runs row', async () => {
    const container = new Container(config, makeMockDb(), { auth: new MockAuthProvider() });
    const service = new ReviewService(container);

    const result = await service.reviewsForPull(WORKSPACE_ID, PR_ID);

    expect(result).toHaveLength(2);
    const withRun = result.find((r) => r.id === REVIEW_ID_WITH_RUN);
    expect(withRun).toBeDefined();
    expect(withRun!.kind).toBe('review');
    expect(withRun!.run_id).toBe(RUN_ID);
    expect(withRun!.tokens_in).toBe(1500);
    expect(withRun!.tokens_out).toBe(320);
    expect(withRun!.cost_usd).toBe(0.0421);
  });

  it('a review with no run_id gets null metrics (not a crash, not 0)', async () => {
    const container = new Container(config, makeMockDb(), { auth: new MockAuthProvider() });
    const service = new ReviewService(container);

    const result = await service.reviewsForPull(WORKSPACE_ID, PR_ID);

    const noRun = result.find((r) => r.id === REVIEW_ID_NO_RUN);
    expect(noRun).toBeDefined();
    expect(noRun!.run_id).toBeNull();
    expect(noRun!.tokens_in).toBeNull();
    expect(noRun!.tokens_out).toBeNull();
    expect(noRun!.cost_usd).toBeNull();
  });
});
