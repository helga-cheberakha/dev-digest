/**
 * CostDelta — cost-change indicator between the current and previous window.
 *
 * Renders "-$0.01 (-8%)" style text, colour-coded AND with a directional
 * glyph so the signal is never colour-alone (WCAG 2.1 AA):
 *   ↓  cheaper  → green (var(--ok))
 *   ↑  pricier  → red   (var(--crit))
 *   →  no change
 *
 * When either value is null (unpriced run, historical data gap) → "—".
 * Uses formatCost (src/lib/cost.ts) which already distinguishes null ("—")
 * from genuine zero ("$0.00").
 */

import React from "react";
import { formatCost } from "@/lib/cost";

export function CostDelta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  // Either null → no meaningful delta to display
  if (current === null || previous === null) {
    return (
      <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>—</span>
    );
  }

  const delta = current - previous;
  const absDelta = Math.abs(delta);

  // Treat deltas that would round to "$0.00" as "no change" (avoids a
  // misleading aria-label like "decreased by $0.00" for real sub-cent deltas)
  if (absDelta < 0.001) {
    return (
      <span style={{ color: "var(--text-muted)" }} className="tnum">
        → {formatCost(0)} (0%)
      </span>
    );
  }

  const cheaper = delta < 0;
  const glyph = cheaper ? "↓" : "↑";
  const color = cheaper ? "var(--ok)" : "var(--crit)";
  const sign = cheaper ? "-" : "+";

  // pctChange is null when previous === 0 (avoid divide-by-zero)
  const pctChange = previous !== 0 ? (delta / previous) * 100 : null;
  const pctText =
    pctChange !== null
      ? `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(0)}%`
      : null;

  // formatCost returns "$X.XX"; prepend ±sign before the "$"
  const signedCost = `${sign}${formatCost(absDelta)}`; // e.g. "-$0.01"

  const ariaLabel = [
    `Cost ${cheaper ? "decreased" : "increased"} by ${formatCost(absDelta)}`,
    pctText ? `(${pctText})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      style={{ color, fontWeight: 600 }}
      className="tnum"
      aria-label={ariaLabel}
    >
      {glyph} {signedCost}
      {pctText !== null && (
        <span
          style={{ fontSize: 11, marginLeft: 4, opacity: 0.85 }}
        >
          ({pctText})
        </span>
      )}
    </span>
  );
}
