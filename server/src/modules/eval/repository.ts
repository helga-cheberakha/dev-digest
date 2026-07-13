import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** The full persisted shape of an eval_cases row. Used by the service layer. */
export type EvalCaseRow = typeof t.evalCases.$inferSelect;

type InsertCaseValues = Omit<typeof t.evalCases.$inferInsert, 'id'>;
type InsertRunValues = Omit<typeof t.evalRuns.$inferInsert, 'id' | 'caseId' | 'ranAt'>;

/**
 * Infrastructure layer — eval case + run data access.
 * Owns queries over `eval_cases` and `eval_runs`.
 *
 * Multi-tenancy guard: every query that touches eval data joins or filters by
 * `eval_cases.workspace_id` to prevent cross-tenant data leakage.
 */
export class EvalRepository {
  constructor(private readonly db: Db) {}

  /** List all eval cases for a given owner (agent or skill) in a workspace. */
  async listCases(
    workspaceId: string,
    ownerKind: typeof t.evalCases.$inferSelect['ownerKind'],
    ownerId: string,
  ) {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  /** Get a single eval case by id, scoped by workspace. Returns undefined if not found. */
  async getCase(workspaceId: string, caseId: string) {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, caseId),
        ),
      );
    return row;
  }

  /** Insert a new eval case and return the persisted row. */
  async insertCase(values: InsertCaseValues) {
    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return row!;
  }

  /**
   * Update an existing eval case in place, scoped by workspace.
   * Returns the updated row, or undefined if no matching case existed.
   */
  async updateCase(
    workspaceId: string,
    caseId: string,
    values: InsertCaseValues,
  ) {
    const [row] = await this.db
      .update(t.evalCases)
      .set(values)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, caseId),
        ),
      )
      .returning();
    return row;
  }

  /**
   * Delete an eval case, scoped by workspace. `eval_runs` rows referencing
   * this case cascade-delete via the FK (schema `onDelete: 'cascade'`).
   * Returns true if a row was deleted, false if no matching case existed.
   */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, caseId),
        ),
      )
      .returning({ id: t.evalCases.id });
    return deleted.length > 0;
  }

  /**
   * Insert a new eval run row and return the persisted row.
   * The caller is responsible for passing `batchId` and `agentVersion` —
   * the repository does not invent them.
   */
  async insertRun(caseId: string, values: InsertRunValues) {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({ caseId, ...values })
      .returning();
    return row!;
  }

  /**
   * Return all runs for a specific eval case, newest first.
   * Joins eval_cases to enforce the workspace_id multi-tenancy guard.
   */
  async runsForCase(workspaceId: string, caseId: string) {
    return this.db
      .select({
        id: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        ranAt: t.evalRuns.ranAt,
        actualOutput: t.evalRuns.actualOutput,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
        batchId: t.evalRuns.batchId,
        agentVersion: t.evalRuns.agentVersion,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalRuns.caseId, caseId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
  }

  /**
   * Return the most recent run for each eval case owned by `ownerId`.
   * Used for pass/fail listing in the eval case table.
   * Implements "latest per case" via a subquery on max(ran_at).
   */
  async latestRunPerCase(workspaceId: string, ownerId: string) {
    // Subquery: max ran_at per case
    const latestSubq = this.db
      .select({
        caseId: t.evalRuns.caseId,
        maxRanAt: sql<Date>`max(${t.evalRuns.ranAt})`.as('max_ran_at'),
      })
      .from(t.evalRuns)
      .groupBy(t.evalRuns.caseId)
      .as('latest_subq');

    return this.db
      .select({
        caseId: t.evalRuns.caseId,
        caseName: t.evalCases.name,
        ranAt: t.evalRuns.ranAt,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        batchId: t.evalRuns.batchId,
        agentVersion: t.evalRuns.agentVersion,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .innerJoin(
        latestSubq,
        and(
          eq(t.evalRuns.caseId, latestSubq.caseId),
          sql`${t.evalRuns.ranAt} = ${latestSubq.maxRanAt}`,
        ),
      )
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  /**
   * Return aggregated batch summaries for an owner, grouped by batch_id.
   * Rows with `batch_id IS NULL` are defensively excluded — they are orphan
   * legacy runs that were never part of a batch execution.
   * Ordered newest batch first.
   *
   * NOTE: `recall`, `precision`, and `citationAccuracy` use SQL `avg()` — a
   * macro-average over per-row stored values. Use `batchRunsWithExpectedForOwner`
   * + `scoring.aggregate` when you need TRUE pooled aggregation.
   */
  async batchesForOwner(workspaceId: string, ownerId: string) {
    return this.db
      .select({
        batchId: t.evalRuns.batchId,
        ranAt: sql<Date>`max(${t.evalRuns.ranAt})`.as('ran_at'),
        agentVersion: t.evalRuns.agentVersion,
        recall: sql<number>`avg(${t.evalRuns.recall})`.as('recall'),
        precision: sql<number>`avg(${t.evalRuns.precision})`.as('precision'),
        citationAccuracy: sql<number>`avg(${t.evalRuns.citationAccuracy})`.as(
          'citation_accuracy',
        ),
        tracesPassed: sql<number>`cast(sum(case when ${t.evalRuns.pass} then 1 else 0 end) as int)`.as(
          'traces_passed',
        ),
        tracesTotal: sql<number>`cast(count(*) as int)`.as('traces_total'),
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, ownerId),
          isNotNull(t.evalRuns.batchId),
        ),
      )
      .groupBy(t.evalRuns.batchId, t.evalRuns.agentVersion)
      .orderBy(desc(sql`max(${t.evalRuns.ranAt})`));
  }

  /**
   * Return ALL individual run rows (with their case's `expected_output`) for
   * every batch owned by `ownerId`, scoped by workspace.
   *
   * Rows with `batch_id IS NULL` are excluded (same rule as `batchesForOwner`).
   * Ordered by `ran_at` ascending so that JS-side grouping produces a stable
   * insertion-order map keyed by `batch_id`.
   *
   * Used by the analytics layer to compute TRUE pooled recall / precision /
   * citation_accuracy from the raw stored data — `scoring.scoreCase` +
   * `scoring.aggregate` are applied per-batch in JS, matching the formula
   * used during live batch execution in `service.runBatch`.
   */
  async batchRunsWithExpectedForOwner(workspaceId: string, ownerId: string) {
    return this.db
      .select({
        batchId: t.evalRuns.batchId,
        ranAt: t.evalRuns.ranAt,
        agentVersion: t.evalRuns.agentVersion,
        pass: t.evalRuns.pass,
        caseName: t.evalCases.name,
        actualOutput: t.evalRuns.actualOutput,
        expectedOutput: t.evalCases.expectedOutput,
        costUsd: t.evalRuns.costUsd,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, ownerId),
          isNotNull(t.evalRuns.batchId),
        ),
      )
      .orderBy(t.evalRuns.ranAt);
  }

  /**
   * Return all runs belonging to a specific batch, scoped by workspace + owner.
   * Rows are ordered by ran_at ascending (insertion / execution order).
   */
  async runsForBatch(workspaceId: string, ownerId: string, batchId: string) {
    return this.db
      .select({
        id: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        caseName: t.evalCases.name,
        ranAt: t.evalRuns.ranAt,
        actualOutput: t.evalRuns.actualOutput,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
        batchId: t.evalRuns.batchId,
        agentVersion: t.evalRuns.agentVersion,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, ownerId),
          eq(t.evalRuns.batchId, batchId),
        ),
      )
      .orderBy(t.evalRuns.ranAt);
  }

  /**
   * Return the N most recent runs across the entire workspace.
   * Used for workspace-wide dashboard displays.
   */
  async recentRuns(workspaceId: string, limit = 20) {
    return this.db
      .select({
        id: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        caseName: t.evalCases.name,
        ranAt: t.evalRuns.ranAt,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        batchId: t.evalRuns.batchId,
        agentVersion: t.evalRuns.agentVersion,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }
}
