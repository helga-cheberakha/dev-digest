/**
 * AcceptRateGauge — radial SVG ring gauge for a 0..1 accept-rate value.
 *
 * Uses the stroke-dasharray trick (a partial stroke on a circle) to fill
 * a ring proportional to the rate. Numeric percentage is always visible
 * as text in the ring centre so shape/colour alone do not carry the signal
 * (WCAG 2.1 AA).
 *
 * When acceptRate === null (no acted findings yet in the window) a distinct
 * "No data" empty state is rendered — never a 0%-filled gauge, which would
 * mislead a viewer into thinking the agent has 0% acceptance.
 */

import React from "react";

const SIZE = 80;
const SW = 9; // stroke width
const R = (SIZE - SW) / 2;
const CIRC = 2 * Math.PI * R;

export function AcceptRateGauge({ acceptRate }: { acceptRate: number | null }) {
  if (acceptRate === null) {
    return (
      <div
        role="img"
        aria-label="Accept rate: no data"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        <svg width={SIZE} height={SIZE} aria-hidden="true">
          {/* Empty track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--border)"
            strokeWidth={SW}
          />
          {/* Placeholder glyph centred in ring */}
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={14}
            fontWeight={600}
          >
            —
          </text>
        </svg>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No data</span>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(1, acceptRate));
  const filled = pct * CIRC;
  const pctText = `${Math.round(pct * 100)}%`;

  return (
    <div
      role="img"
      aria-label={`Accept rate: ${pctText}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <div style={{ position: "relative", width: SIZE, height: SIZE }}>
        {/* Ring SVG rotated so fill starts at 12 o'clock */}
        <svg
          width={SIZE}
          height={SIZE}
          style={{ transform: "rotate(-90deg)" }}
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--bg-elevated)"
            strokeWidth={SW}
          />
          {/* Filled arc */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--ok)"
            strokeWidth={SW}
            strokeDasharray={`${filled.toFixed(2)} ${CIRC.toFixed(2)}`}
            strokeLinecap="round"
          />
        </svg>
        {/* Numeric label in the centre — visible text (not shape-only) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          {pctText}
        </div>
      </div>
    </div>
  );
}
