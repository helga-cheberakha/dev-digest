import { eq, sql } from 'drizzle-orm';
import type { Brief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Infrastructure layer — the only file touching `pr_brief`.
 *
 * Fixed feature-namespace constant used as the `classid` (first key) of the
 * two-arg `pg_advisory_xact_lock(classid, objid)` call in `withPrLock`. Keeps
 * this feature's advisory locks from colliding with any other feature that
 * might later take advisory locks on the same Postgres cluster (m1).
 */
export const BRIEF_LOCK_NS = 87_412_003;

export interface BriefCache {
  /** Parsed cached Brief, or `null` if no row exists yet for this PR. */
  brief: Brief | null;
  /**
   * The `head_sha` the cached Brief was generated against. `null` both when
   * there is no row and when a legacy row predates the `head_sha` column —
   * callers must treat a `null` head_sha as a cache miss either way.
   */
  headSha: string | null;
}

export class BriefRepository {
  constructor(private readonly db: Db) {}

  /** Reads the cached Brief (JSON) + the head_sha it was generated against. */
  async read(prId: string): Promise<BriefCache> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return { brief: null, headSha: null };
    return { brief: row.json as Brief, headSha: row.headSha ?? null };
  }

  /** Reads the PR's current `head_sha` — the value the cache is compared against. */
  async currentHead(prId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ headSha: t.pullRequests.headSha })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, prId));
    return row?.headSha ?? null;
  }

  /** Upserts the cached Brief together with the head_sha it was generated against. */
  async upsert(prId: string, brief: Brief, headSha: string): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: brief, headSha })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: { json: brief, headSha },
      });
  }

  /**
   * Runs `fn` inside a `db.transaction` guarded by a PR-scoped Postgres
   * advisory lock (AC-17): `pg_advisory_xact_lock($BRIEF_LOCK_NS,
   * hashtext($prId))`, the two-arg form, taken as the transaction's first
   * statement.
   *
   * Concurrent Brief-generation requests for the same PR serialize instead of
   * racing duplicate LLM calls. The lock lives inside the transaction (not a
   * session-level `pg_advisory_lock`) so it pins to the transaction's single
   * pooled connection (postgres-js pools connections across requests) and
   * auto-releases on commit or rollback — no manual unlock bookkeeping.
   *
   * Runs at READ COMMITTED, the Postgres / postgres-js default — do NOT wrap
   * this in a REPEATABLE READ transaction. A waiter's post-lock cache re-read
   * must observe the winner's just-committed row, which only holds under READ
   * COMMITTED; under REPEATABLE READ the waiter's snapshot would predate the
   * winner's commit and it would (incorrectly) re-run the LLM call, violating
   * AC-17.
   */
  async withPrLock<T>(prId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${BRIEF_LOCK_NS}, hashtext(${prId}))`);
      return fn(tx);
    });
  }
}
