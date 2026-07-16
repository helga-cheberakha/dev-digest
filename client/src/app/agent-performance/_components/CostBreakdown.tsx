"use client";

/**
 * CostBreakdown — two donut charts side by side:
 *   "Cost breakdown by agent" and "Cost breakdown by model".
 *
 * Pure presentational: props in, no data fetching.
 * Uses `withColors` from colors.ts to deterministically assign colours to each
 * segment before passing to the vendor `Donut` component.
 *
 * Note: `Donut` uses Recharts (PieChart) which requires a client component,
 * hence the "use client" directive.
 */

import React from "react";
import type { PerfCostSegment } from "@devdigest/shared";
import { Donut } from "@devdigest/ui";
import { withColors } from "./colors";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CostBreakdownProps {
  costByAgent: PerfCostSegment[];
  costByModel: PerfCostSegment[];
}

// ---------------------------------------------------------------------------
// Internal sub-component
// ---------------------------------------------------------------------------

function DonutCard({
  title,
  segments,
}: {
  title: string;
  segments: PerfCostSegment[];
}) {
  const colored = withColors(segments);

  if (segments.length === 0) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "16px 20px",
          flex: 1,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          {title}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          No cost recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 20px",
        flex: 1,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <Donut segments={colored} valuePrefix="$" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostBreakdown({ costByAgent, costByModel }: CostBreakdownProps) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <DonutCard title="Cost breakdown: by agent" segments={costByAgent} />
      <DonutCard title="Cost breakdown: by model" segments={costByModel} />
    </div>
  );
}
