/**
 * Infrastructure layer — agent-performance data access.
 *
 * The ONLY file in this module allowed to import drizzle-orm or db/schema.
 * All queries are workspace-scoped. Returns plain domain rows; callers
 * (service) map them to DTOs via helpers.ts.
 *
 * Index used: agent_runs_agent_id_status_ran_at_idx (agent_id, status, ran_at)
 * — the three columns appear in every WHERE/ORDER clause here; no new index added.
 *
 * postgres-js array-binding note (INSIGHTS 2026-07-16):
 *   `WHERE agent_id = ANY(${arr})` is rejected at runtime. Fix: inline a
 *   parameterised ARRAY[...]::uuid[] literal where each element still goes
 *   through its own placeholder.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { TimeWindow } from './helpers.js';
import type { AgentAgg } from './helpers.js';

// ---------------------------------------------------------------------------
// Raw row shapes from the DB (internal to this file)
// ---------------------------------------------------------------------------

interface RunStatsRow extends Record<string, unknown> {
  agent_id: string;
  runs: string; // COUNT(*) → bigint string in postgres-js
  total_cost_usd: number | null;
  avg_cost_usd: number | null;
  avg_latency_ms: number | null;
  last_run_at: Date | null;
  provider: string | null;
  model: string | null;
}

interface FindingsStatsRow extends Record<string, unknown> {
  agent_id: string;
  findings_total: string;
  accepted: string;
  dismissed: string;
  pending: string;
  critical: string;
  warning: string;
  suggestion: string;
}

interface RecentRunRow extends Record<string, unknown> {
  agent_id: string;
  findings_count: number | null;
  ran_at: Date;
}

interface CostByModelRow extends Record<string, unknown> {
  model: string | null;
  value: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AgentPerformanceRepository {
  constructor(private readonly db: Db) {}

  /**
   * Return per-agent aggregate rows for the given workspace and time window.
   * Optionally scoped to a single agent when `agentId` is provided.
   *
   * Merges two queries:
   *   1. Run-level stats (count, cost, latency, last_run_at, provider/model).
   *   2. Findings stats via reviews (totals, accept/dismiss/pending, by severity).
   */
  async aggregateAgents(
    workspaceId: string,
    window: TimeWindow,
    agentId?: string,
  ): Promise<AgentAgg[]> {
    const agentFilter = agentId
      ? sql`AND agent_id = ${agentId}::uuid`
      : sql``;

    // ---- Query 1: run-level stats -------------------------------------------
    // Uses agent_runs_agent_id_status_ran_at_idx via (status, ran_at) filter.
    // array_agg(… ORDER BY ran_at DESC)[1] picks provider/model from the most
    // recent done run in the window without a second query.
    const runRows = (await this.db.execute<RunStatsRow>(sql`
      SELECT
        agent_id,
        COUNT(*)::text                                                     AS runs,
        SUM(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)                 AS total_cost_usd,
        AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)                 AS avg_cost_usd,
        AVG(duration_ms)                                                   AS avg_latency_ms,
        MAX(ran_at)                                                        AS last_run_at,
        (array_agg(provider ORDER BY ran_at DESC))[1]                     AS provider,
        (array_agg(model    ORDER BY ran_at DESC))[1]                     AS model
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}::uuid
        AND status = 'done'
        AND ran_at >= ${window.fromTs}
        AND ran_at <= ${window.toTs}
        ${agentFilter}
      GROUP BY agent_id
    `)) as unknown as RunStatsRow[];

    if (runRows.length === 0) return [];

    // ---- Query 2: findings stats via reviews --------------------------------
    // Joins agent_runs → reviews (on run_id + agent_id) → findings.
    // The same window + workspace + agent filter scopes to the identical run set.
    const findingRows = (await this.db.execute<FindingsStatsRow>(sql`
      SELECT
        r.agent_id,
        COUNT(f.id)::text                                                            AS findings_total,
        COUNT(f.id) FILTER (WHERE f.accepted_at IS NOT NULL)::text                  AS accepted,
        COUNT(f.id) FILTER (WHERE f.dismissed_at IS NOT NULL)::text                 AS dismissed,
        COUNT(f.id) FILTER (WHERE f.accepted_at IS NULL AND f.dismissed_at IS NULL)::text AS pending,
        COUNT(f.id) FILTER (WHERE f.severity = 'CRITICAL')::text                    AS critical,
        COUNT(f.id) FILTER (WHERE f.severity = 'WARNING')::text                     AS warning,
        COUNT(f.id) FILTER (WHERE f.severity = 'SUGGESTION')::text                  AS suggestion
      FROM agent_runs ar
      JOIN reviews r
        ON r.run_id   = ar.id
       AND r.agent_id = ar.agent_id
      JOIN findings f ON f.review_id = r.id
      WHERE ar.workspace_id = ${workspaceId}::uuid
        AND ar.status = 'done'
        AND ar.ran_at >= ${window.fromTs}
        AND ar.ran_at <= ${window.toTs}
        ${agentFilter}
      GROUP BY r.agent_id
    `)) as unknown as FindingsStatsRow[];

    const findingsByAgentId = new Map(findingRows.map((r) => [r.agent_id, r]));

    return runRows.map((r): AgentAgg => {
      const f = findingsByAgentId.get(r.agent_id);
      return {
        agentId: r.agent_id,
        // agentName is resolved in the service from the agents list
        agentName: '',
        runs: Number(r.runs),
        totalCostUsd: r.total_cost_usd,
        avgCostUsd: r.avg_cost_usd,
        avgLatencyMs: r.avg_latency_ms,
        lastRunAt: r.last_run_at,
        provider: r.provider,
        model: r.model,
        findingsTotal: f ? Number(f.findings_total) : 0,
        accepted: f ? Number(f.accepted) : 0,
        dismissed: f ? Number(f.dismissed) : 0,
        pending: f ? Number(f.pending) : 0,
        findingsBySeverity: {
          CRITICAL: f ? Number(f.critical) : 0,
          WARNING: f ? Number(f.warning) : 0,
          SUGGESTION: f ? Number(f.suggestion) : 0,
        },
      };
    });
  }

  /**
   * For each agent in `agentIds`, return the last `n` done runs'
   * findings_count (stored column), ordered oldest→newest.
   *
   * Uses ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY ran_at DESC)
   * to pick the most-recent n rows per agent — mirrors the house style in
   * multi-agent/repository.ts:getMostRecentDoneRunsForAgents.
   *
   * Returns a Map<agentId, [{findingsCount, ranAt}, …]> sorted oldest→newest.
   * Agents with zero done runs are absent from the map.
   */
  async recentRunSeries(
    workspaceId: string,
    agentIds: string[],
    n: number,
  ): Promise<Map<string, { findingsCount: number; ranAt: Date }[]>> {
    if (agentIds.length === 0) return new Map();

    // postgres-js rejects plain arrays bound to ANY($1). Each element is its
    // own placeholder inside ARRAY[...]::uuid[] (INSIGHTS 2026-07-16).
    const agentIdList = sql.join(
      agentIds.map((id) => sql`${id}`),
      sql`, `,
    );

    const rows = (await this.db.execute<RecentRunRow>(sql`
      WITH ranked AS (
        SELECT
          agent_id,
          findings_count,
          ran_at,
          ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY ran_at DESC) AS rn
        FROM agent_runs
        WHERE workspace_id = ${workspaceId}::uuid
          AND status = 'done'
          AND agent_id = ANY(ARRAY[${agentIdList}]::uuid[])
      )
      SELECT agent_id, findings_count, ran_at
      FROM ranked
      WHERE rn <= ${n}
      ORDER BY agent_id, ran_at ASC
    `)) as unknown as RecentRunRow[];

    const result = new Map<string, { findingsCount: number; ranAt: Date }[]>();
    for (const row of rows) {
      let series = result.get(row.agent_id);
      if (!series) {
        series = [];
        result.set(row.agent_id, series);
      }
      series.push({
        findingsCount: row.findings_count ?? 0,
        ranAt: row.ran_at,
      });
    }
    return result;
  }

  /**
   * Sum of cost_usd over priced done runs in the window, grouped by model.
   * Optionally filtered to a subset of agents (for the per-workspace donut).
   * Returns only models that have at least one priced run.
   */
  async costByModel(
    workspaceId: string,
    window: TimeWindow,
    agentIds?: string[],
  ): Promise<{ model: string; value: number }[]> {
    const agentFilter =
      agentIds && agentIds.length > 0
        ? sql`AND agent_id = ANY(ARRAY[${sql.join(
            agentIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`
        : sql``;

    const rows = (await this.db.execute<CostByModelRow>(sql`
      SELECT
        model,
        SUM(cost_usd) AS value
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}::uuid
        AND status = 'done'
        AND cost_usd IS NOT NULL
        AND ran_at >= ${window.fromTs}
        AND ran_at <= ${window.toTs}
        ${agentFilter}
      GROUP BY model
    `)) as unknown as CostByModelRow[];

    return rows.map((r) => ({
      model: r.model ?? '(unknown)',
      value: Number(r.value),
    }));
  }
}
