import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Infrastructure layer — multi-agent data access.
 * The ONLY layer touching the DB for the multi-agent domain.
 * Owns: multi_agent_runs (parent row) + the agent_runs rows that carry the FK.
 * Read assembly for GET /multi-agent-runs/:id.
 * Estimate query for GET /agent-estimates.
 */
export class MultiAgentRepository {
  constructor(private readonly db: Db) {}

  // ---- write: parent row + child runs ----------------------------------------

  /**
   * Insert the multi_agent_runs parent row and its N agent_runs rows (FK set)
   * in a single transaction, so a failure partway through never leaves an
   * orphaned parent whose agent_ids.length exceeds its actually-created runs.
   * Returns the parent id and the created run ids, in the same order as `agents`.
   */
  async createRunWithAgentRuns(
    parent: { workspaceId: string; prId: string; agentIds: string[] },
    agents: {
      agentId: string;
      provider: string | null;
      model: string | null;
    }[],
  ): Promise<{ id: string; run_ids: string[] }> {
    return this.db.transaction(async (tx) => {
      const [parentRow] = await tx
        .insert(t.multiAgentRuns)
        .values(parent)
        .returning({ id: t.multiAgentRuns.id });
      const parentId = parentRow!.id;

      const runRows = await tx
        .insert(t.agentRuns)
        .values(
          agents.map((agent) => ({
            workspaceId: parent.workspaceId,
            agentId: agent.agentId,
            prId: parent.prId,
            provider: agent.provider,
            model: agent.model,
            multiAgentRunId: parentId,
            status: 'running' as const,
            source: 'local' as const,
          })),
        )
        .returning({ id: t.agentRuns.id });

      return { id: parentId, run_ids: runRows.map((r) => r.id) };
    });
  }

  // ---- read: parent row + PR number ------------------------------------------

  async getParentRun(
    workspaceId: string,
    id: string,
  ): Promise<
    | {
        id: string;
        prId: string;
        ranAt: Date;
        agentIds: string[];
        prNumber: number | null;
      }
    | undefined
  > {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
        agentIds: t.multiAgentRuns.agentIds,
        prNumber: t.pullRequests.number,
      })
      .from(t.multiAgentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(
        and(eq(t.multiAgentRuns.id, id), eq(t.multiAgentRuns.workspaceId, workspaceId)),
      );
    if (!row) return undefined;
    return {
      id: row.id,
      prId: row.prId,
      ranAt: row.ranAt,
      agentIds: row.agentIds,
      prNumber: row.prNumber ?? null,
    };
  }

  // ---- read: associated agent runs (with agent metadata) ---------------------

  async getAssociatedRuns(
    multiAgentRunId: string,
  ): Promise<{ run: typeof t.agentRuns.$inferSelect; agentName: string | null }[]> {
    const rows = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));
    return rows.map((r) => ({ run: r.run, agentName: r.agentName ?? null }));
  }

  // ---- read: reviews + findings for a set of agent run IDs ------------------

  async getReviewsForRuns(
    runIds: string[],
  ): Promise<
    {
      review: typeof t.reviews.$inferSelect;
      findings: (typeof t.findings.$inferSelect)[];
    }[]
  > {
    if (runIds.length === 0) return [];
    const reviews = await this.db
      .select()
      .from(t.reviews)
      .where(inArray(t.reviews.runId, runIds));
    if (reviews.length === 0) return [];
    const reviewIds = reviews.map((r) => r.id);
    const findings = await this.db
      .select()
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewIds));
    return reviews.map((review) => ({
      review,
      findings: findings.filter((f) => f.reviewId === review.id),
    }));
  }

  // ---- read: estimates — most-recent done run per agent (global) -------------

  /**
   * For each agentId, return the single most-recent status='done' agent_runs row
   * across all workspaces/PRs, plus that run's review summary.
   * Returns one entry per agentId that has at least one done run; omits agents
   * with zero done runs (the caller maps those to null estimates).
   */
  async getMostRecentDoneRunsForAgents(agentIds: string[]): Promise<
    {
      agentId: string;
      durationMs: number | null;
      costUsd: number | null;
      reviewSummary: string | null;
    }[]
  > {
    if (agentIds.length === 0) return [];

    // Fetch all done runs for the given agents, ordered newest-first.
    // We take the first per agent in JS (avoids a DISTINCT ON raw SQL).
    const runs = await this.db
      .select({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
        ranAt: t.agentRuns.ranAt,
      })
      .from(t.agentRuns)
      .where(
        and(
          inArray(t.agentRuns.agentId, agentIds),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt));

    if (runs.length === 0) return [];

    // Take the most-recent run per agent
    const seenAgents = new Set<string>();
    const mostRecent: (typeof runs)[number][] = [];
    for (const run of runs) {
      if (run.agentId && !seenAgents.has(run.agentId)) {
        seenAgents.add(run.agentId);
        mostRecent.push(run);
      }
    }

    // Fetch review summaries for those runs (one review per run)
    const runIds = mostRecent.map((r) => r.id);
    const reviews = await this.db
      .select({ runId: t.reviews.runId, summary: t.reviews.summary })
      .from(t.reviews)
      .where(inArray(t.reviews.runId, runIds));
    const reviewByRunId = new Map(reviews.map((r) => [r.runId, r.summary]));

    return mostRecent.map((run) => ({
      agentId: run.agentId!,
      durationMs: run.durationMs,
      costUsd: run.costUsd,
      reviewSummary: reviewByRunId.get(run.id) ?? null,
    }));
  }
}
