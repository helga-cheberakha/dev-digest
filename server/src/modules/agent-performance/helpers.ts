/**
 * Pure helper functions for the agent-performance module.
 * No I/O, no imports from db/schema or drizzle-orm.
 */

import type { AgentStats, StatPoint, RunHistoryRow, FindingCategory } from '@devdigest/shared';
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
// Previous-window shift
// ---------------------------------------------------------------------------

/**
 * Shift a window back by its own duration:
 *   newToTs   = window.fromTs
 *   newFromTs = window.fromTs − (window.toTs − window.fromTs)
 *
 * This produces "the immediately preceding equal-length window".
 * Used by getAgentStats to compute avg_cost_usd_prev.
 */
export function previousWindow(window: { fromTs: Date; toTs: Date }): {
  fromTs: Date;
  toTs: Date;
} {
  const durationMs = window.toTs.getTime() - window.fromTs.getTime();
  return {
    fromTs: new Date(window.fromTs.getTime() - durationMs),
    toTs: new Date(window.fromTs.getTime()), // copy so callers can't mutate the original
  };
}

// ---------------------------------------------------------------------------
// Adaptive severity bucketing
// ---------------------------------------------------------------------------

/** Format a bucket start date as a short UTC label (human-readable, not raw ISO). */
function formatBucketLabel(date: Date, bucketMs: number): string {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (bucketMs < DAY) {
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${mo}/${d} ${h}:00`;
  }
  return `${mo}/${d}`;
}

/**
 * Bucket severity rows into adaptive time slices.
 *
 * @param rows   Raw per-finding rows from severityBucketRows() — ran_at as ISO string.
 * @param window The window the rows were fetched for (anchors bucket boundaries).
 * @param target Desired number of buckets; actual count ≈ target (never < 1).
 *
 * Algorithm — adaptive bucket duration:
 *   rawBucket = windowDuration / target
 *   rounded up to the next "sensible unit": 1h, 2h, 4h, 6h, 12h, 1d, 3d, 1w
 *   numBuckets = ⌈windowDuration / bucketMs⌉   (never 0, always ≥ 1)
 *
 * For a 1-day window with target=7: rawBucket ≈ 3.4h → 4h → 6 buckets.
 * For a 30-day window with target=7: rawBucket ≈ 4.3d → 1 week → 5 buckets.
 *
 * Rows outside [fromTs, toTs] are ignored defensively.
 * Buckets are returned ordered oldest→newest.
 * Unrecognised severity strings do not increment any counter.
 */
export function bucketSeverity(
  rows: { ran_at: string; severity: string }[],
  window: { fromTs: Date; toTs: Date },
  target: number,
): { label: string; CRITICAL: number; WARNING: number; SUGGESTION: number }[] {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  const windowMs = window.toTs.getTime() - window.fromTs.getTime();
  const rawBucket = windowMs / Math.max(target, 1);

  // Round rawBucket up to the nearest sensible time unit
  let bucketMs: number;
  if (rawBucket <= HOUR)          { bucketMs = HOUR; }
  else if (rawBucket <= 2 * HOUR) { bucketMs = 2 * HOUR; }
  else if (rawBucket <= 4 * HOUR) { bucketMs = 4 * HOUR; }
  else if (rawBucket <= 6 * HOUR) { bucketMs = 6 * HOUR; }
  else if (rawBucket <= 12 * HOUR) { bucketMs = 12 * HOUR; }
  else if (rawBucket <= DAY)      { bucketMs = DAY; }
  else if (rawBucket <= 3 * DAY)  { bucketMs = 3 * DAY; }
  else                             { bucketMs = WEEK; }

  const fromMs = window.fromTs.getTime();
  const numBuckets = Math.max(1, Math.ceil(windowMs / bucketMs));

  // Initialise empty buckets (oldest → newest)
  const buckets: { label: string; CRITICAL: number; WARNING: number; SUGGESTION: number }[] = [];
  for (let i = 0; i < numBuckets; i++) {
    buckets.push({
      label: formatBucketLabel(new Date(fromMs + i * bucketMs), bucketMs),
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
  }

  // Assign each finding row to its bucket
  const toMs = window.toTs.getTime();
  for (const row of rows) {
    const rowMs = new Date(row.ran_at).getTime();
    // Defensive: ignore out-of-window rows
    if (rowMs < fromMs || rowMs > toMs) continue;
    const idx = Math.min(Math.floor((rowMs - fromMs) / bucketMs), numBuckets - 1);
    const bucket = buckets[idx]!;
    if (row.severity === 'CRITICAL')        bucket.CRITICAL++;
    else if (row.severity === 'WARNING')    bucket.WARNING++;
    else if (row.severity === 'SUGGESTION') bucket.SUGGESTION++;
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Cost-by-category attribution
// ---------------------------------------------------------------------------

/**
 * Attribute run cost to finding categories via proportional allocation.
 *
 * For each (run, category) row returned by costByCategoryRows():
 *   contribution = category_finding_count × (cost_usd / run_finding_count)
 *
 * Contributions are summed by category; categories with no rows are absent
 * from the result (omit-not-zero convention matches the spec).
 * Rows with run_finding_count === 0 are skipped defensively (the repository
 * query already excludes zero-finding runs, but guard here too).
 */
export function sumCostByCategory(
  rows: {
    category: string;
    cost_usd: number;
    category_finding_count: number;
    run_finding_count: number;
  }[],
): { category: FindingCategory; cost_usd: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.run_finding_count === 0) continue; // defensive guard
    const contribution = row.category_finding_count * (row.cost_usd / row.run_finding_count);
    totals.set(row.category, (totals.get(row.category) ?? 0) + contribution);
  }
  return Array.from(totals.entries()).map(([category, cost_usd]) => ({
    category: category as FindingCategory,
    cost_usd,
  }));
}

// ---------------------------------------------------------------------------
// Run history row mapper
// ---------------------------------------------------------------------------

/**
 * Structural type for the raw row returned by AgentPerformanceRepository.runHistory().
 * Defined inline (not imported from repository.ts) to avoid a circular module edge.
 * Structurally identical to RawRunHistoryRow — TypeScript's structural typing ensures
 * a RawRunHistoryRow is always assignable to this interface.
 */
interface RawRunInput extends Record<string, unknown> {
  run_id: string;
  ran_at: string; // timestamptz → string from postgres-js
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  findings_count: number | null;
  source: string;
  status: string | null;
  pr_number: number | null;
  pr_title: string | null;
  pr_repo_id: string | null;
  has_trace: boolean;
}

/**
 * Map a raw run history row from the repository to the RunHistoryRow contract shape.
 * Pure: no I/O, no side effects.
 *
 * `ran_at` is normalised via `new Date(...).toISOString()` for a consistent
 * ISO-8601 string regardless of the exact format postgres-js emits.
 * `source` is cast to the union literal — the DB constraint guarantees validity.
 */
export function toRunHistoryRow(raw: RawRunInput): RunHistoryRow {
  return {
    run_id: raw.run_id,
    ran_at: new Date(raw.ran_at).toISOString(),
    pr_number: raw.pr_number,
    pr_title: raw.pr_title,
    pr_repo_id: raw.pr_repo_id,
    tokens_in: raw.tokens_in,
    tokens_out: raw.tokens_out,
    cost_usd: raw.cost_usd,
    findings_count: raw.findings_count,
    source: raw.source as 'local' | 'ci',
    status: raw.status,
    has_trace: raw.has_trace,
  };
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
 * Map an AgentAgg + trend series + enrichment extras to an AgentStats DTO.
 *
 * Null-safety rules (applied strictly, no throws):
 *   - accept_rate / dismiss_rate → null when accepted + dismissed === 0
 *   - avg_findings_per_run / avg_cost_usd / avg_latency_ms → null when runs === 0
 *   - total_cost_usd / avg_cost_usd → null when there are zero priced runs
 *   - avg_cost_usd_prev → null when the previous window had no priced runs
 */
export function toAgentStats(
  agg: AgentAgg,
  trend: StatPoint[],
  extras: {
    avgCostUsdPrev: number | null;
    severityByBucket: ReturnType<typeof bucketSeverity>;
    costByCategory: ReturnType<typeof sumCostByCategory>;
  },
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
    avg_cost_usd_prev: extras.avgCostUsdPrev,
    severity_by_bucket: extras.severityByBucket,
    cost_by_category: extras.costByCategory,
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
