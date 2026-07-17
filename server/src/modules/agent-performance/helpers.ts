/**
 * Pure helper functions for the agent-performance module.
 * No I/O, no imports from db/schema or drizzle-orm.
 */

import type { AgentStats, StatPoint } from '@devdigest/shared';
import type { AgentPerfRow } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Window resolution
// ---------------------------------------------------------------------------

export interface TimeWindow {
  fromTs: Date;
  toTs: Date;
}

/**
 * Resolve a query time window from a period preset or explicit from/to dates.
 *
 * Presets are TRAILING (rolling), not calendar-aligned:
 *   '30d' → now − 30 days .. now
 *   '1d'  → now − 24 hours .. now
 *
 * 'custom' → inclusive UTC [from 00:00:00.000Z .. to 23:59:59.999Z].
 *
 * Never throws — invalid/missing custom dates fall back to a 30-day window.
 */
export function resolveWindow(
  period: string,
  from?: string,
  to?: string,
): TimeWindow {
  const now = new Date();

  if (period === '1d') {
    const fromTs = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { fromTs, toTs: now };
  }

  if (period === 'custom' && from && to) {
    // Inclusive: from = start of day UTC, to = end of day UTC
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const fromTs = new Date(
      Date.UTC(
        fromDate.getUTCFullYear(),
        fromDate.getUTCMonth(),
        fromDate.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const toTs = new Date(
      Date.UTC(
        toDate.getUTCFullYear(),
        toDate.getUTCMonth(),
        toDate.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
    return { fromTs, toTs };
  }

  // Default: '30d' or anything unrecognised → trailing 30 days
  const fromTs = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { fromTs, toTs: now };
}

// ---------------------------------------------------------------------------
// Raw aggregate shape returned by the repository
// ---------------------------------------------------------------------------

/**
 * Shape of the per-agent aggregate row returned by AgentPerformanceRepository.
 * The repository is the only file that produces this; helpers consume it.
 */
export interface AgentAgg {
  agentId: string;
  agentName: string;
  runs: number;
  /** Sum of cost_usd over priced runs only (null when zero priced runs). */
  totalCostUsd: number | null;
  /** Avg of cost_usd over priced runs only (null when zero priced runs). */
  avgCostUsd: number | null;
  /** Avg duration_ms over done runs (null when runs === 0). */
  avgLatencyMs: number | null;
  findingsTotal: number;
  accepted: number;
  dismissed: number;
  pending: number;
  findingsBySeverity: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  /** Provider from the agent's most-recent done run in window (null if no runs). */
  provider: string | null;
  /** Model from the agent's most-recent done run in window (null if no runs). */
  model: string | null;
  /** All-time most-recent ran_at across done runs (null if no done runs ever).
   *  NOT window-scoped — always reflects the true last run regardless of the
   *  period the operator has selected. */
  lastRunAt: Date | null;
}

// ---------------------------------------------------------------------------
// DTO mappers
// ---------------------------------------------------------------------------

/**
 * Map an AgentAgg + trend series to an AgentStats DTO.
 *
 * Null-safety rules (applied strictly, no throws):
 *   - accept_rate / dismiss_rate → null when accepted + dismissed === 0
 *   - avg_findings_per_run / avg_cost_usd / avg_latency_ms → null when runs === 0
 *   - total_cost_usd / avg_cost_usd → null when there are zero priced runs
 */
export function toAgentStats(
  agg: AgentAgg,
  trend: StatPoint[],
): AgentStats {
  const acted = agg.accepted + agg.dismissed;
  const acceptRate = acted === 0 ? null : agg.accepted / acted;
  const dismissRate = acted === 0 ? null : agg.dismissed / acted;

  return {
    agent_id: agg.agentId,
    agent_name: agg.agentName,
    runs: agg.runs,
    findings_total: agg.findingsTotal,
    accepted: agg.accepted,
    dismissed: agg.dismissed,
    pending: agg.pending,
    accept_rate: acceptRate,
    dismiss_rate: dismissRate,
    avg_findings_per_run: agg.runs === 0 ? null : agg.findingsTotal / agg.runs,
    total_cost_usd: agg.totalCostUsd,
    avg_cost_usd: agg.runs === 0 ? null : agg.avgCostUsd,
    avg_latency_ms: agg.runs === 0 ? null : agg.avgLatencyMs,
    findings_by_severity: agg.findingsBySeverity,
    trend,
  };
}

/**
 * Map an AgentAgg + trend numbers to an AgentPerfRow DTO.
 *
 * Same null-safety rules as toAgentStats.
 * trend is the raw findings_count numbers oldest→newest.
 */
export function toAgentPerfRow(
  agg: AgentAgg,
  trend: number[],
): AgentPerfRow {
  const acted = agg.accepted + agg.dismissed;
  const acceptRate = acted === 0 ? null : agg.accepted / acted;
  const dismissRate = acted === 0 ? null : agg.dismissed / acted;

  return {
    agent_id: agg.agentId,
    agent_name: agg.agentName,
    provider: agg.provider,
    model: agg.model,
    runs: agg.runs,
    findings_total: agg.findingsTotal,
    accepted: agg.accepted,
    dismissed: agg.dismissed,
    accept_rate: acceptRate,
    dismiss_rate: dismissRate,
    avg_findings_per_run: agg.runs === 0 ? null : agg.findingsTotal / agg.runs,
    total_cost_usd: agg.totalCostUsd,
    avg_cost_usd: agg.runs === 0 ? null : agg.avgCostUsd,
    avg_latency_ms: agg.runs === 0 ? null : agg.avgLatencyMs,
    last_run_at: agg.lastRunAt ? agg.lastRunAt.toISOString() : null,
    findings_by_severity: agg.findingsBySeverity,
    trend,
  };
}
