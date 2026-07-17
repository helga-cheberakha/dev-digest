"use client";

/**
 * SummaryCards — four metric cards at the top of the Agent Performance page.
 *
 * Rendering rules (acceptance-tested):
 *   - total_cost_usd === null  → "—"   (never "$0.00")
 *   - avg_accept_rate === null → "—"   (never "0%"; same glyph as null cost)
 *
 * Both nulls mean "no data recorded yet", not a genuine zero value.
 */

import React from "react";
import type { AgentPerf } from "@devdigest/shared";
import type { PerfWindow } from "@/lib/api";
import { formatCost } from "@/lib/cost";
import { NO_DATA_GLYPH } from "@/lib/colors";
import { CircularScore } from "@devdigest/ui";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SummaryCardsProps {
  summary: AgentPerf["summary"];
  /** The currently-selected period window. Drives the label suffix on the
   *  "Total runs" and "Total cost" cards. Defaults to 30d behaviour when
   *  omitted so existing callers without the prop keep working. */
  period?: PerfWindow;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a short label suffix that reflects the selected period window:
 *   30d      → "(30d)"
 *   1d       → "(24h)"
 *   custom   → "(custom)"
 */
function periodSuffix(period: PerfWindow | undefined): string {
  if (!period || period.period === "30d") return "(30d)";
  if (period.period === "1d") return "(24h)";
  return "(custom)";
}

function StatCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: React.ReactNode;
  /** Optional ring badge rendered in the card's top-right corner (e.g. accept-rate gauge). */
  badge?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 120,
        flex: 1,
        textAlign: "center",
      }}
    >
      {badge != null && (
        <div style={{ position: "absolute", top: 8, right: 8 }}>{badge}</div>
      )}
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: "var(--text-primary)",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 4,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Format accept_rate (0..1) as a percentage string, or NO_DATA_GLYPH for null. */
function formatAcceptRate(rate: number | null): string {
  if (rate === null) return NO_DATA_GLYPH;
  return `${Math.round(rate * 100)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SummaryCards({ summary, period }: SummaryCardsProps) {
  const suffix = periodSuffix(period);
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <StatCard label={`Total runs ${suffix}`} value={summary.runs} />
      {/* formatCost already returns "—" for null — matches the null-cost rule */}
      <StatCard label={`Total cost ${suffix}`} value={formatCost(summary.total_cost_usd)} />
      <StatCard
        label="Avg accept-rate"
        value={formatAcceptRate(summary.avg_accept_rate)}
        badge={
          summary.avg_accept_rate !== null ? (
            <CircularScore
              score={Math.round(summary.avg_accept_rate * 100)}
              size={36}
              stroke={3}
            />
          ) : undefined
        }
      />
      <StatCard label="Most active" value={summary.most_active_agent ?? NO_DATA_GLYPH} />
    </div>
  );
}
