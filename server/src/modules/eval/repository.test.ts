/**
 * EvalRepository integration tests.
 *
 * These tests require a live PostgreSQL instance. They are gated on
 * `process.env.DATABASE_URL` (present in CI and locally when server/.env
 * is configured) and skipped cleanly otherwise.
 *
 * The `config.ts` import of `dotenv/config` ensures that `server/.env` is
 * loaded on every vitest run, so these tests run locally whenever the dev DB
 * is up (see INSIGHTS.md 2026-07-07 on config.ts dotenv loading).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb, type DbHandle } from '../../db/client.js';
import { EvalRepository } from './repository.js';
import * as t from '../../db/schema.js';

// Load dotenv so DATABASE_URL is present when server/.env exists.
import '../../platform/config.js';

describe.skipIf(!process.env.DATABASE_URL)(
  'EvalRepository — batch queries (real Postgres)',
  () => {
    let handle: DbHandle;
    let repo: EvalRepository;
    let workspaceId: string;

    beforeAll(async () => {
      handle = createDb(process.env.DATABASE_URL!, { max: 5 });
      repo = new EvalRepository(handle.db);

      // Create an isolated workspace; cascade-delete cleans all child rows.
      const [ws] = await handle.db
        .insert(t.workspaces)
        .values({ name: `eval-repo-test-${randomUUID()}` })
        .returning();
      workspaceId = ws!.id;
    });

    afterAll(async () => {
      if (workspaceId) {
        // Cascade: workspaces → eval_cases → eval_runs
        await handle.db.delete(t.workspaces).where(eq(t.workspaces.id, workspaceId));
      }
      await handle?.close();
    });

    it('runsForBatch returns exactly N rows sharing a batch_id', async () => {
      const ownerId = randomUUID();
      const batchId = randomUUID();
      const N = 3;

      // Insert one eval case for this owner.
      const ec = await repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: 'runsForBatch-case',
        inputDiff: '',
      });

      // Insert N runs sharing the same batch_id.
      for (let i = 0; i < N; i++) {
        await repo.insertRun(ec.id, {
          batchId,
          agentVersion: 1,
          pass: true,
          recall: 1,
          precision: 1,
          citationAccuracy: 1,
        });
      }

      const runs = await repo.runsForBatch(workspaceId, ownerId, batchId);

      expect(runs).toHaveLength(N);
      expect(runs.every((r) => r.batchId === batchId)).toBe(true);
    });

    it('batchesForOwner excludes runs whose batch_id is null', async () => {
      const ownerId = randomUUID();
      const batchId = randomUUID();

      // Insert one eval case.
      const ec = await repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: 'batchesForOwner-case',
        inputDiff: '',
      });

      // Insert 2 runs with a batch_id (they form one batch).
      await repo.insertRun(ec.id, { batchId, agentVersion: 2, pass: true, recall: 1, precision: 1, citationAccuracy: 1 });
      await repo.insertRun(ec.id, { batchId, agentVersion: 2, pass: false, recall: 0, precision: 0, citationAccuracy: 0 });

      // Insert 1 orphan run with batch_id = null.
      await repo.insertRun(ec.id, { batchId: null, agentVersion: null, pass: null });

      const batches = await repo.batchesForOwner(workspaceId, ownerId);

      // The null-batch run must not appear as its own batch.
      expect(batches).toHaveLength(1);
      expect(batches[0]!.batchId).toBe(batchId);
      // Both batched runs count toward the total; the null run is excluded.
      expect(batches[0]!.tracesTotal).toBe(2);
    });
  },
);
