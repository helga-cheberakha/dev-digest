/**
 * CI data-access. Owns `ci_installations` and `ci_runs`.
 *
 * Follows the repository pattern from `modules/agents/repository.ts`:
 * - All queries are typed via Drizzle's `$inferSelect`
 * - No HTTP or business logic here — pure DB access
 * - `insertCiRunWithAgentRun` runs both inserts in one transaction (AC atomicity)
 */
import { and, desc, eq, isNotNull, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallation, CiRun } from '@devdigest/shared';

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

export interface InsertInstallation {
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
}

export interface InsertCiRunData {
  ciInstallationId: string;
  workspaceId: string;
  agentId: string;
  prNumber: number | null;
  status: string | null;
  findingsCount: number;
  costUsd: number | null;
  githubUrl: string;
  /** Display name for the CI Runs page (e.g. "GitHub Actions"). Stored on ciRuns.source. */
  source: string;
  githubRunId: string;
  durationMs: number | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- ci_installations -------------------------------------------------------

  async insertInstallation(values: InsertInstallation): Promise<CiInstallationRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: values.agentId,
        repo: values.repo,
        targetType: values.targetType,
      })
      .returning();
    return row!;
  }

  async listInstallationsForAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));
  }

  /**
   * All installations for agents in a workspace (joined through agents table).
   * Used by the T4 Refresh ingestion to find all repos to check.
   */
  async installationsForWorkspace(workspaceId: string): Promise<
    Array<{
      installation: CiInstallationRow;
      agent: { id: string; name: string; workspaceId: string };
    }>
  > {
    const rows = await this.db
      .select({
        installation: t.ciInstallations,
        agentId: t.agents.id,
        agentName: t.agents.name,
        agentWorkspaceId: t.agents.workspaceId,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));

    return rows.map((r) => ({
      installation: r.installation,
      agent: {
        id: r.agentId,
        name: r.agentName,
        workspaceId: r.agentWorkspaceId,
      },
    }));
  }

  // ---- ci_runs ----------------------------------------------------------------

  /**
   * Return the set of github_run_ids already recorded for an installation.
   * Used by T4 to dedup BEFORE calling downloadRunArtifact.
   */
  async existingRunIdsForInstallation(installationId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ githubRunId: t.ciRuns.githubRunId })
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installationId),
          isNotNull(t.ciRuns.githubRunId),
        ),
      );
    return new Set(rows.filter((r) => r.githubRunId != null).map((r) => r.githubRunId!));
  }

  /**
   * Insert one `ci_runs` row + one paired `agent_runs` row in a SINGLE
   * transaction. Always INSERT — never upsert (the pre-check in the ingestion
   * loop prevents re-inserting the same run; the unique constraint is the
   * backstop). Returns the new ci_run id.
   */
  async insertCiRunWithAgentRun(data: InsertCiRunData): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [ciRun] = await tx
        .insert(t.ciRuns)
        .values({
          ciInstallationId: data.ciInstallationId,
          prNumber: data.prNumber,
          status: data.status,
          findingsCount: data.findingsCount,
          costUsd: data.costUsd,
          githubUrl: data.githubUrl,
          source: data.source,
          githubRunId: data.githubRunId,
          ranAt: new Date(),
        })
        .returning();

      await tx.insert(t.agentRuns).values({
        workspaceId: data.workspaceId,
        agentId: data.agentId,
        source: 'ci',
        status: 'done',
        findingsCount: data.findingsCount,
        costUsd: data.costUsd,
        durationMs: data.durationMs,
      });

      return ciRun!.id;
    });
  }

  /**
   * List all CI runs for a workspace, newest first.
   *
   * Joined through `ci_installations` → `agents` to get workspace scoping
   * and the agent name. The `source` column on `ci_runs` stores the display
   * name (e.g. "GitHub Actions") set at insert time — so it survives if the
   * installation is later deleted.
   */
  async listCiRuns(workspaceId: string): Promise<CiRun[]> {
    const rows = await this.db
      .select({
        id: t.ciRuns.id,
        ciInstallationId: t.ciRuns.ciInstallationId,
        prNumber: t.ciRuns.prNumber,
        ranAt: t.ciRuns.ranAt,
        status: t.ciRuns.status,
        findingsCount: t.ciRuns.findingsCount,
        costUsd: t.ciRuns.costUsd,
        githubUrl: t.ciRuns.githubUrl,
        source: t.ciRuns.source,
        agentName: t.agents.name,
        githubRunId: t.ciRuns.githubRunId,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt));

    return rows.map((r) => ({
      id: r.id,
      ci_installation_id: r.ciInstallationId,
      pr_number: r.prNumber,
      ran_at: r.ranAt?.toISOString() ?? null,
      status: r.status,
      findings_count: r.findingsCount,
      cost_usd: r.costUsd,
      github_url: r.githubUrl,
      source: r.source,
      agent: r.agentName ?? null,
      github_run_id: r.githubRunId ?? null,
    }));
  }

  // ---- DTO mappers (used by routes) ------------------------------------------

  static toInstallationDto(row: CiInstallationRow): CiInstallation {
    return {
      id: row.id,
      agent_id: row.agentId,
      repo: row.repo,
      target_type: row.targetType as CiInstallation['target_type'],
      installed_at: row.installedAt.toISOString(),
    };
  }
}
