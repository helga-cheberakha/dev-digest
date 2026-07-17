/**
 * Application layer — agent-performance orchestration.
 *
 * Produces AgentPerf (workspace summary) and AgentStats (per-agent detail).
 * Depends only on:
 *   - AgentPerformanceRepository (repository.ts, in this module)
 *   - container.agentsRepo (agents list/getById)
 *   - container.db (passed to the repository)
 *
 * MUST NOT import LLMProvider, run-executor, or any adapter.
 * A grep gate enforces this: grep -rn "LLMProvider|run-executor|runExecutor"
 * server/src/modules/agent-performance/ must return nothing.
 */

import type { Container } from '../../platform/container.js';
import type { AgentPerf, AgentPerfRow, PerfCostSegment, AgentStats, StatPoint } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { AgentPerformanceRepository } from './repository.js';
import { toAgentPerfRow, toAgentStats, type AgentAgg, type TimeWindow } from './helpers.js';
import { TREND_RUN_COUNT } from './constants.js';

export class AgentPerformanceService {
  private readonly repo: AgentPerformanceRepository;

  constructor(private readonly container: Container) {
    this.repo = new AgentPerformanceRepository(container.db);
  }

  // ---------------------------------------------------------------------------
  // Private: shared aggregation
  // ---------------------------------------------------------------------------

  /**
   * Fetch per-agent aggregates and merge with the full agent list so that
   * agents with ZERO done runs in the window are still represented as rows
   * with runs=0 and null-safe fields (never dropped).
   */
  private async aggregate(
    workspaceId: string,
    window: TimeWindow,
    agentId?: string,
  ): Promise<AgentAgg[]> {
    // allTimeLastRunAt is NOT window-scoped: it returns the true all-time
    // most-recent done run per agent, so last_run_at is correct even when the
    // operator selects a narrow period that predates the agent's actual last run.
    const [repoAggs, allAgents, lastRunAtMap] = await Promise.all([
      this.repo.aggregateAgents(workspaceId, window, agentId),
      this.container.agentsRepo.list(workspaceId),
      this.repo.allTimeLastRunAt(workspaceId, agentId ? [agentId] : undefined),
    ]);

    const aggById = new Map(repoAggs.map((a) => [a.agentId, a]));

    // Filter to the requested agent if given; otherwise use all workspace agents.
    const relevantAgents = agentId
      ? allAgents.filter((a) => a.id === agentId)
      : allAgents;

    return relevantAgents.map((agent): AgentAgg => {
      const lastRunAt = lastRunAtMap.get(agent.id) ?? null;
      const existing = aggById.get(agent.id);
      if (existing) {
        // Patch in the agent name (repository doesn't join agents table) and
        // the all-time last_run_at (not the windowed null from aggregateAgents).
        return { ...existing, agentName: agent.name, lastRunAt };
      }
      // Zero-run placeholder — all numeric aggregates are null-safe defaults.
      // lastRunAt comes from allTimeLastRunAt so it's still correct for agents
      // that ran outside the selected window.
      return {
        agentId: agent.id,
        agentName: agent.name,
        runs: 0,
        totalCostUsd: null,
        avgCostUsd: null,
        avgLatencyMs: null,
        lastRunAt,
        provider: null,
        model: null,
        findingsTotal: 0,
        accepted: 0,
        dismissed: 0,
        pending: 0,
        findingsBySeverity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Public: workspace-wide performance dashboard
  // ---------------------------------------------------------------------------

  /**
   * GET /agents/performance  →  AgentPerf
   *
   * Summary rules (fixed decisions):
   *   - total_cost_usd: sum of priced runs across all agents.
   *   - avg_accept_rate: POOLED = Σaccepted / Σ(accepted+dismissed); null when
   *     zero acted findings across all agents.
   *   - most_active_agent: agent name with highest runs, tie-break by higher
   *     total_cost_usd, then by agent_name ascending.
   *   - cost_by_agent / cost_by_model: derived from the same priced-run set so
   *     all three cost sums agree exactly.
   */
  async getPerformance(workspaceId: string, window: TimeWindow): Promise<AgentPerf> {
    const aggs = await this.aggregate(workspaceId, window);

    // Collect agent ids that have at least one run (for trend + cost queries)
    const activeAgentIds = aggs.filter((a) => a.runs > 0).map((a) => a.agentId);

    // Fetch trend series and cost-by-model in parallel (skip if no active agents)
    const [seriesMap, modelCosts] = await Promise.all([
      activeAgentIds.length > 0
        ? this.repo.recentRunSeries(workspaceId, activeAgentIds, TREND_RUN_COUNT)
        : Promise.resolve(new Map<string, { findingsCount: number; ranAt: Date }[]>()),
      this.repo.costByModel(workspaceId, window),
    ]);

    // Map aggs → AgentPerfRow (trend = raw findings_count numbers)
    const agents: AgentPerfRow[] = aggs.map((agg) => {
      const series = seriesMap.get(agg.agentId) ?? [];
      const trend = series.map((p) => p.findingsCount);
      return toAgentPerfRow(agg, trend);
    });

    // ---- Summary ----
    const totalRuns = aggs.reduce((s, a) => s + a.runs, 0);

    // Pooled accept rate across all agents' acted findings
    const totalAccepted = aggs.reduce((s, a) => s + a.accepted, 0);
    const totalActed = aggs.reduce((s, a) => s + a.accepted + a.dismissed, 0);
    const avgAcceptRate = totalActed === 0 ? null : totalAccepted / totalActed;

    // Total cost (sum of per-agent total_cost_usd where non-null)
    let hasPricedAgent = false;
    let totalCostUsd = 0;
    for (const agg of aggs) {
      if (agg.totalCostUsd !== null) {
        hasPricedAgent = true;
        totalCostUsd += agg.totalCostUsd;
      }
    }
    const summaryTotalCostUsd = hasPricedAgent ? totalCostUsd : null;

    // Most active agent: highest runs → higher cost → agent_name asc
    let mostActiveAgent: string | null = null;
    if (aggs.length > 0) {
      const sorted = [...aggs].sort((a, b) => {
        if (b.runs !== a.runs) return b.runs - a.runs;
        const aCost = a.totalCostUsd ?? -Infinity;
        const bCost = b.totalCostUsd ?? -Infinity;
        if (bCost !== aCost) return bCost - aCost;
        return a.agentName.localeCompare(b.agentName);
      });
      mostActiveAgent = sorted[0]!.agentName;
    }

    // cost_by_agent: per-agent cost segments (only agents with priced runs)
    const costByAgent: PerfCostSegment[] = aggs
      .filter((a) => a.totalCostUsd !== null)
      .map((a) => ({ label: a.agentName, value: a.totalCostUsd! }));

    // cost_by_model: from the same priced-run set (already computed by repo)
    const costByModel: PerfCostSegment[] = modelCosts.map((m) => ({
      label: m.model,
      value: m.value,
    }));

    return {
      summary: {
        runs: totalRuns,
        total_cost_usd: summaryTotalCostUsd,
        avg_accept_rate: avgAcceptRate,
        most_active_agent: mostActiveAgent,
      },
      agents,
      cost_by_agent: costByAgent,
      cost_by_model: costByModel,
    };
  }

  // ---------------------------------------------------------------------------
  // Public: single-agent stats
  // ---------------------------------------------------------------------------

  /**
   * GET /agents/:id/stats  →  AgentStats
   *
   * Throws NotFoundError when the agent does not exist in the workspace.
   * Trend StatPoint.label is the run's ISO date string (ran_at).
   */
  async getAgentStats(
    workspaceId: string,
    agentId: string,
    window: TimeWindow,
  ): Promise<AgentStats> {
    // Verify the agent exists; throw 404 so T2's route can map it
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [aggs, seriesMap] = await Promise.all([
      this.aggregate(workspaceId, window, agentId),
      this.repo.recentRunSeries(workspaceId, [agentId], TREND_RUN_COUNT),
    ]);

    // There should be exactly one element (the agent), but default to zero-run
    const agg: AgentAgg = aggs[0] ?? {
      agentId,
      agentName: agent.name,
      runs: 0,
      totalCostUsd: null,
      avgCostUsd: null,
      avgLatencyMs: null,
      lastRunAt: null,
      provider: null,
      model: null,
      findingsTotal: 0,
      accepted: 0,
      dismissed: 0,
      pending: 0,
      findingsBySeverity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
    };

    // Trend as StatPoint[] — same underlying series as AgentPerfRow.trend
    // (identical findingsCount values), with ranAt ISO label for the stats tab.
    const series = seriesMap.get(agentId) ?? [];
    const trend: StatPoint[] = series.map((p) => ({
      label: p.ranAt.toISOString(),
      value: p.findingsCount,
    }));

    return toAgentStats(agg, trend);
  }
}
