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

// avgCostPrevWindow — AVG(doublePrecision)::float → JS number (or null)
interface AvgCostRow extends Record<string, unknown> {
  avg_cost_usd: number | null;
}

// severityBucketRows — raw per-finding rows; ran_at as string (timestamptz via db.execute())
interface SeverityFindingRow extends Record<string, unknown> {
  ran_at: string; // timestamptz → string; caller casts with new Date()
  severity: string;
}

// costByCategoryRows — one row per (run, category) pair
// cost_usd: doublePrecision → JS number (not a string)
// category_finding_count/run_finding_count: COUNT/SUM cast ::int → JS number
interface CostByCategoryDbRow extends Record<string, unknown> {
  category: string;
  cost_usd: number;
  category_finding_count: number;
  run_finding_count: number;
}

/**
 * One row per agent run from the Run History query.
 * Exported so T3 (helpers/service) can reference the exact shape.
 *
 * Notes on types returned by db.execute() / postgres-js:
 *   - timestamptz columns → string (caller casts with `new Date(ran_at)`)
 *   - doublePrecision (cost_usd) → JS number | null
 *   - integer columns (tokens_in, tokens_out, findings_count) → JS number | null
 *   - boolean expression (has_trace) → JS boolean
 */
export interface RawRunHistoryRow extends Record<string, unknown> {
  run_id: string;
  ran_at: string; // timestamptz → string
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null; // doublePrecision → JS number
  findings_count: number | null;
  source: string; // 'local' | 'ci'
  status: string | null;
  pr_number: number | null; // from pull_requests.number
  pr_title: string | null; // from pull_requests.title
  pr_repo_id: string | null; // from pull_requests.repo_id
  has_trace: boolean; // run_traces.run_id IS NOT NULL
}

// runHistoryCount — COUNT(*)::text → string, converted by Number()
interface CountRow extends Record<string, unknown> {
  count: string;
}

interface RunStatsRow extends Record<string, unknown> {
  agent_id: string;
  runs: string; // COUNT(*) → bigint string in postgres-js
  total_cost_usd: number | null;
  avg_cost_usd: number | null;
  // AVG(integer column) → postgres NUMERIC → postgres-js returns as string.
  // Cast via Number() in the mapping below.
  avg_latency_ms: string | null;
  provider: string | null;
  model: string | null;
}

// last_run_at is intentionally NOT in RunStatsRow — it is computed all-time
// (unwindowed) by allTimeLastRunAt() and merged in by service.aggregate().

interface LastRunRow extends Record<string, unknown> {
  agent_id: string;
  // db.execute() returns timestamptz as a string, not a Date object.
  last_run_at: string;
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
  // db.execute() returns timestamptz as a string, not a Date object.
  ran_at: string;
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
   *   1. Run-level stats (count, cost, latency, provider/model) — window-scoped.
   *   2. Findings stats via reviews (totals, accept/dismiss/pending, by severity).
   *
   * Note: last_run_at is NOT computed here (it was previously window-scoped via
   * MAX(ran_at), which was incorrect). The service calls allTimeLastRunAt() and
   * patches it in after this method returns. AgentAgg.lastRunAt is always null
   * coming out of this method.
   */
  async aggregateAgents(
    workspaceId: string,
    window: TimeWindow,
    agentId?: string,
  ): Promise<AgentAgg[]> {
    // Query 1: agent_runs only — bare column is unambiguous.
    const agentFilter = agentId
      ? sql`AND agent_id = ${agentId}::uuid`
      : sql``;

    // Query 2: agent_runs ar JOIN reviews r — both tables have agent_id; must qualify.
    const agentFilterQ2 = agentId
      ? sql`AND ar.agent_id = ${agentId}::uuid`
      : sql``;

    // ---- Query 1: run-level stats (window-scoped) ---------------------------
    // Uses agent_runs_agent_id_status_ran_at_idx via (status, ran_at) filter.
    // array_agg(… ORDER BY ran_at DESC)[1] picks provider/model from the most
    // recent done run in the window without a second query.
    // MAX(ran_at) is intentionally OMITTED here — last_run_at must reflect the
    // all-time most-recent done run, not the most-recent within the window.
    // It is computed unwindowed by allTimeLastRunAt() and merged in by the service.
    const runRows = (await this.db.execute<RunStatsRow>(sql`
      SELECT
        agent_id,
        COUNT(*)::text                                                     AS runs,
        SUM(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)                 AS total_cost_usd,
        AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)                 AS avg_cost_usd,
        AVG(duration_ms)                                                   AS avg_latency_ms,
        (array_agg(provider ORDER BY ran_at DESC))[1]                     AS provider,
        (array_agg(model    ORDER BY ran_at DESC))[1]                     AS model
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}::uuid
        AND status = 'done'
        AND ran_at >= ${window.fromTs.toISOString()}::timestamptz
        AND ran_at <= ${window.toTs.toISOString()}::timestamptz
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
        AND ar.ran_at >= ${window.fromTs.toISOString()}::timestamptz
        AND ar.ran_at <= ${window.toTs.toISOString()}::timestamptz
        ${agentFilterQ2}
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
        avgLatencyMs: r.avg_latency_ms !== null ? Number(r.avg_latency_ms) : null,
        // lastRunAt is always null here; service.aggregate() patches it in from
        // allTimeLastRunAt() so it reflects the true all-time most-recent done run.
        lastRunAt: null,
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
        ranAt: new Date(row.ran_at),
      });
    }
    return result;
  }

  /**
   * Return the all-time most-recent `done` ran_at per agent, scoped only by
   * workspace and status — NOT filtered by any time window.
   *
   * Called by service.aggregate() after aggregateAgents() so that
   * AgentPerfRow.last_run_at reflects the true last run regardless of which
   * period the operator has selected.
   *
   * When `agentIds` is provided, only those agents are queried (for single-agent
   * or partial lookups). When omitted, all workspace agents are included.
   */
  async allTimeLastRunAt(
    workspaceId: string,
    agentIds?: string[],
  ): Promise<Map<string, Date>> {
    const agentFilter =
      agentIds && agentIds.length > 0
        ? sql`AND agent_id = ANY(ARRAY[${sql.join(
            agentIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`
        : sql``;

    const rows = (await this.db.execute<LastRunRow>(sql`
      SELECT agent_id, MAX(ran_at) AS last_run_at
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}::uuid
        AND status = 'done'
        ${agentFilter}
      GROUP BY agent_id
    `)) as unknown as LastRunRow[];

    // db.execute() returns timestamptz as a string — cast via new Date().
    return new Map(rows.map((r) => [r.agent_id, new Date(r.last_run_at)]));
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
        AND ran_at >= ${window.fromTs.toISOString()}::timestamptz
        AND ran_at <= ${window.toTs.toISOString()}::timestamptz
        ${agentFilter}
      GROUP BY model
    `)) as unknown as CostByModelRow[];

    return rows.map((r) => ({
      model: r.model ?? '(unknown)',
      value: Number(r.value),
    }));
  }

  /**
   * Average cost_usd over `done` runs in the given previous window for one agent.
   *
   * Uses `AVG(...) FILTER (WHERE cost_usd IS NOT NULL)` so unpriced runs are
   * excluded from the denominator (same convention as the rest of this module).
   * The `::float` cast ensures postgres-js returns a JS number, not a NUMERIC string.
   *
   * Returns null when there are no priced done runs in the window.
   * The window boundaries are [fromTs, toTs] inclusive.
   *
   * NOTE: computing *what* the "previous window" means is T3's responsibility
   * (`previousWindow()` helper). This method accepts a ready-made {fromTs, toTs}.
   */
  async avgCostPrevWindow(
    workspaceId: string,
    agentId: string,
    prevWindow: { fromTs: Date; toTs: Date },
  ): Promise<number | null> {
    // Upper bound is STRICT less-than (<) to avoid double-counting the boundary instant.
    // previousWindow() sets toTs === current window's fromTs (same millisecond).
    // The current window uses ran_at >= fromTs (inclusive), so a run AT fromTs belongs
    // to the current window only — using `<` here makes the two windows disjoint.
    const rows = (await this.db.execute<AvgCostRow>(sql`
      SELECT
        AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)::float AS avg_cost_usd
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}::uuid
        AND agent_id     = ${agentId}::uuid
        AND status       = 'done'
        AND ran_at >= ${prevWindow.fromTs.toISOString()}::timestamptz
        AND ran_at <  ${prevWindow.toTs.toISOString()}::timestamptz
    `)) as unknown as AvgCostRow[];

    return rows[0]?.avg_cost_usd ?? null;
  }

  /**
   * Raw per-finding rows for bucketing into a severity-over-time series.
   *
   * Returns one row per finding from `done` runs in the window.
   * Bucketing into weekly/adaptive time slots is done by the T3 pure helper
   * (`bucketSeverityRows`) so that logic stays unit-testable without DB access.
   *
   * NOTE: `ran_at` is the agent run timestamp; postgres-js returns timestamptz
   * columns as strings — T3 calls `new Date(row.ran_at)` to convert.
   *
   * Join: agent_runs ar → reviews r (r.run_id = ar.id AND r.agent_id = ar.agent_id)
   *                      → findings f (f.review_id = r.id)
   *
   * ar.agent_id is explicitly qualified to avoid the "column reference is ambiguous"
   * error when both agent_runs and reviews expose an agent_id column (INSIGHTS 2026-07-17).
   */
  async severityBucketRows(
    workspaceId: string,
    agentId: string,
    window: { fromTs: Date; toTs: Date },
  ): Promise<{ ran_at: string; severity: string }[]> {
    return (await this.db.execute<SeverityFindingRow>(sql`
      SELECT ar.ran_at, f.severity
      FROM agent_runs ar
      JOIN reviews r  ON r.run_id   = ar.id
                     AND r.agent_id = ar.agent_id
      JOIN findings f ON f.review_id = r.id
      WHERE ar.workspace_id = ${workspaceId}::uuid
        AND ar.agent_id     = ${agentId}::uuid
        AND ar.status       = 'done'
        AND ar.ran_at >= ${window.fromTs.toISOString()}::timestamptz
        AND ar.ran_at <= ${window.toTs.toISOString()}::timestamptz
    `)) as unknown as { ran_at: string; severity: string }[];
  }

  /**
   * Raw per-(run, category) rows for computing cost_by_category.
   *
   * Returns one row per (agent_run, finding_category) pair, scoped to priced
   * done runs in the window that have at least one finding (unpriced runs and
   * zero-finding runs produce no rows and contribute nothing — AC-7).
   *
   * Exact field semantics (T3 depends on these names exactly):
   *   category              — finding category ('bug'|'security'|'perf'|'style'|'test')
   *   cost_usd              — the run's total cost in USD (repeated per-category row)
   *   category_finding_count — count of findings of this category for this run
   *   run_finding_count     — total finding count across ALL categories for this run
   *                           (= SUM of category_finding_count over the same run_id)
   *
   * T3's `sumCostByCategory` uses these to compute, per category-row:
   *   contribution = category_finding_count × (cost_usd / run_finding_count)
   * then sums contributions by category.  This implements the decided formula:
   *   cost_per_finding = run.cost_usd / run.total_findings;
   *   sum cost_per_finding for each finding, grouped by finding.category.
   *
   * Implementation:
   *   CTE groups by (ar.id, ar.cost_usd, f.category) → category_finding_count.
   *   Window function SUM(...) OVER (PARTITION BY run_id) → run_finding_count.
   *   Both counts are cast ::int; postgres-js returns INTEGER as JS number.
   *   cost_usd is doublePrecision → JS number (no cast needed).
   *
   * ar.agent_id is qualified (INSIGHTS 2026-07-17 ambiguity guard).
   */
  async costByCategoryRows(
    workspaceId: string,
    agentId: string,
    window: { fromTs: Date; toTs: Date },
  ): Promise<
    {
      category: string;
      cost_usd: number;
      category_finding_count: number;
      run_finding_count: number;
    }[]
  > {
    return (await this.db.execute<CostByCategoryDbRow>(sql`
      WITH per_run_category AS (
        SELECT
          ar.id            AS run_id,
          ar.cost_usd,
          f.category,
          COUNT(f.id)::int AS category_finding_count
        FROM agent_runs ar
        JOIN reviews r  ON r.run_id   = ar.id
                       AND r.agent_id = ar.agent_id
        JOIN findings f ON f.review_id = r.id
        WHERE ar.workspace_id = ${workspaceId}::uuid
          AND ar.agent_id     = ${agentId}::uuid
          AND ar.status       = 'done'
          AND ar.cost_usd IS NOT NULL
          AND ar.ran_at >= ${window.fromTs.toISOString()}::timestamptz
          AND ar.ran_at <= ${window.toTs.toISOString()}::timestamptz
        GROUP BY ar.id, ar.cost_usd, f.category
      )
      SELECT
        category,
        cost_usd,
        category_finding_count,
        (SUM(category_finding_count) OVER (PARTITION BY run_id))::int AS run_finding_count
      FROM per_run_category
    `)) as unknown as CostByCategoryDbRow[];
  }

  /**
   * Paginated run history rows for one agent within the window.
   *
   * Deliberately does NOT filter by status='done' — Run History must include
   * ALL statuses (pending/failed/cancelled runs too) per the spec (AC-8, AC-10).
   * This is an intentional deviation from every other method in this repository,
   * which all filter status='done'.
   *
   * Joins:
   *   LEFT JOIN pull_requests pr  ON pr.id = ar.pr_id
   *     → pr_number, pr_title, pr_repo_id (all null when pr_id is null or PR deleted)
   *   LEFT JOIN run_traces rt ON rt.run_id = ar.id
   *     → has_trace = (rt.run_id IS NOT NULL)
   *
   * Return shape: see exported RawRunHistoryRow interface above.
   * timestamps (ran_at) returned as strings — caller converts with new Date().
   *
   * Ordered ran_at DESC (newest first) per AC-8.
   */
  async runHistory(
    workspaceId: string,
    agentId: string,
    window: { fromTs: Date; toTs: Date },
    limit: number,
    offset: number,
  ): Promise<RawRunHistoryRow[]> {
    return (await this.db.execute<RawRunHistoryRow>(sql`
      SELECT
        ar.id              AS run_id,
        ar.ran_at,
        ar.tokens_in,
        ar.tokens_out,
        ar.cost_usd,
        ar.findings_count,
        ar.source,
        ar.status,
        pr.number          AS pr_number,
        pr.title           AS pr_title,
        pr.repo_id         AS pr_repo_id,
        (rt.run_id IS NOT NULL) AS has_trace
      FROM agent_runs ar
      LEFT JOIN pull_requests pr ON pr.id = ar.pr_id
      LEFT JOIN run_traces    rt ON rt.run_id = ar.id
      WHERE ar.workspace_id = ${workspaceId}::uuid
        AND ar.agent_id     = ${agentId}::uuid
        AND ar.ran_at >= ${window.fromTs.toISOString()}::timestamptz
        AND ar.ran_at <= ${window.toTs.toISOString()}::timestamptz
      ORDER BY ar.ran_at DESC, ar.id DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `)) as unknown as RawRunHistoryRow[];
  }

  /**
   * Total count of agent runs in the window (all statuses, same filter as
   * runHistory) for pagination metadata.
   *
   * COUNT(*)::text → postgres-js bigint string → converted with Number().
   */
  async runHistoryCount(
    workspaceId: string,
    agentId: string,
    window: { fromTs: Date; toTs: Date },
  ): Promise<number> {
    const rows = (await this.db.execute<CountRow>(sql`
      SELECT COUNT(*)::text AS count
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}::uuid
        AND agent_id     = ${agentId}::uuid
        AND ran_at >= ${window.fromTs.toISOString()}::timestamptz
        AND ran_at <= ${window.toTs.toISOString()}::timestamptz
    `)) as unknown as CountRow[];

    return Number(rows[0]?.count ?? '0');
  }
}
