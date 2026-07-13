/* MetricBar — compact progress bar + percentage, shared by the workspace
   dashboard's recent-runs table and the per-agent detail page's runs table. */
"use client";

import React from "react";
import { ProgressBar } from "@devdigest/ui";

export function MetricBar({ value, color }: { value: number | null; color: string }) {
  if (value == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 64, flexShrink: 0 }}>
        <ProgressBar value={pct} color={color} />
      </div>
      <span className="tnum" style={{ fontWeight: 600, color, minWidth: 30 }}>
        {pct}%
      </span>
    </div>
  );
}
