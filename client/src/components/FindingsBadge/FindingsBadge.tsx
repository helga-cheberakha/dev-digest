"use client";

import React from "react";

type Counts = { critical: number; warning: number; suggestion: number };

const SEV: { key: keyof Counts; color: string; symbol: string }[] = [
  { key: "critical", color: "var(--crit)", symbol: "⊘" },
  { key: "warning", color: "var(--warn)", symbol: "△" },
  { key: "suggestion", color: "var(--sugg)", symbol: "◯" },
];

export function FindingsBadge({ counts }: { counts: Counts | null | undefined }) {
  if (!counts) return <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>;

  const nonZero = SEV.filter((s) => counts[s.key] > 0);
  if (nonZero.length === 0) return <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
      {nonZero.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <span style={{ color: "var(--text-muted)" }}>·</span>}
          <span style={{ color: s.color, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span>{s.symbol}</span>
            <span>{counts[s.key]}</span>
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}
