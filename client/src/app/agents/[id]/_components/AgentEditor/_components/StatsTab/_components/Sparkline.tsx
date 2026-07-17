/**
 * Sparkline — a small inline SVG trend line for StatPoint arrays.
 *
 * Props: points (oldest→newest). Zero or one point renders a flat neutral line
 * (per INSIGHTS 2026-07-11: length-1 causes 0/0=NaN in the vendor Sparkline
 * so we guard explicitly). Includes an aria-label summarising the trend
 * direction and range so shape alone does not convey meaning (WCAG 2.1 AA).
 */

import React from "react";
import type { StatPoint } from "@devdigest/shared";

const W = 120;
const H = 36;
const PAD = 2;

export function Sparkline({ points }: { points: StatPoint[] }) {
  // Flat neutral state for 0–1 points (avoids NaN in path "d" attribute)
  if (points.length < 2) {
    const label =
      points.length === 0
        ? "No trend data available"
        : "Only one data point — trend unavailable";
    return (
      <svg width={W} height={H} role="img" aria-label={label}>
        <line
          x1={PAD}
          y1={H / 2}
          x2={W - PAD}
          y2={H / 2}
          stroke="var(--border)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      </svg>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // prevent division by zero when all values equal

  const xStep = (W - PAD * 2) / (points.length - 1);
  const yOf = (v: number): number =>
    H - PAD - ((v - min) / range) * (H - PAD * 2);

  const pathD = points
    .map(
      (pt, i) =>
        `${i === 0 ? "M" : "L"}${(PAD + i * xStep).toFixed(1)},${yOf(pt.value).toFixed(1)}`,
    )
    .join(" ");

  const first = values[0]!;
  const last = values[values.length - 1]!;
  const direction = last > first ? "upward" : last < first ? "downward" : "flat";
  const ariaLabel = `Trend: ${direction}. ${points.length} points, values from ${first} to ${last}.`;

  return (
    <svg width={W} height={H} role="img" aria-label={ariaLabel}>
      <path
        d={pathD}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
