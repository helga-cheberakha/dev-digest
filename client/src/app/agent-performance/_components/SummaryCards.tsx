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
import { formatCost } from "@/lib/cost";
import { NO_DATA_GLYPH } from "./colors";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SummaryCardsProps {
  summary: AgentPerf["summary"];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 120,
        flex: 1,
        textAlign: "center",
      }}
    >
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

export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <StatCard label="Total runs (30d)" value={summary.runs} />
      {/* formatCost already returns "—" for null — matches the null-cost rule */}
      <StatCard label="Total cost (30d)" value={formatCost(summary.total_cost_usd)} />
      <StatCard label="Avg accept-rate" value={formatAcceptRate(summary.avg_accept_rate)} />
      <StatCard label="Most active" value={summary.most_active_agent ?? NO_DATA_GLYPH} />
    </div>
  );
}
