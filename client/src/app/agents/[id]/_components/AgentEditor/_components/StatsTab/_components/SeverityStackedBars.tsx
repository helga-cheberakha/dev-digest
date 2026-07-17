"use client";

/**
 * SeverityStackedBars — stacked bar chart, one bar per time bucket.
 *
 * Each bar is split into three coloured segments (CRITICAL / WARNING /
 * SUGGESTION) using the same colour tokens as StatsTab's severity pills
 * (var(--crit) / var(--warn) / var(--accent)). A legend below the chart
 * identifies the colours so shape/colour alone is not the only signal
 * (WCAG 2.1 AA). Every segment also carries a `title` attribute with its
 * numeric count for screen readers.
 *
 * Edge cases:
 *  - Empty buckets array → empty state, not a crash.
 *  - Bucket with all-zero counts → zero-height bar (empty well), not an error.
 */

import React from "react";
import { useTranslations } from "next-intl";

type Bucket = {
  label: string;
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
};

// Colour tokens matching StatsTab's existing severity pill convention.
// Labels are resolved from translations inside the component (they are
// language-dependent), so only key + color are defined at module level.
const SEV_SEGMENT_DEFS: Array<{
  key: "CRITICAL" | "WARNING" | "SUGGESTION";
  color: string;
}> = [
  { key: "CRITICAL", color: "var(--crit)" },
  { key: "WARNING", color: "var(--warn)" },
  { key: "SUGGESTION", color: "var(--accent)" },
];

const BAR_HEIGHT = 80; // maximum bar height in px

export function SeverityStackedBars({ buckets }: { buckets: Bucket[] }) {
  const t = useTranslations("agents");

  // Resolve translated labels for the three severity levels.
  // Nesting inside the component ensures next-intl's hook contract is met.
  const SEV_SEGMENTS = [
    { ...SEV_SEGMENT_DEFS[0]!, label: t("stats.severity.critical") },
    { ...SEV_SEGMENT_DEFS[1]!, label: t("stats.severity.warning") },
    { ...SEV_SEGMENT_DEFS[2]!, label: t("stats.severity.suggestion") },
  ];

  if (buckets.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
        {t("stats.severity.emptyState")}
      </p>
    );
  }

  const totals = buckets.map((b) => b.CRITICAL + b.WARNING + b.SUGGESTION);
  const maxTotal = Math.max(...totals, 1); // avoid division by zero

  return (
    <div>
      {/* Bars */}
      <div
        role="img"
        aria-label={`Severity stacked bars: ${buckets.length} buckets, colours indicate Critical (red), Warning (amber), Suggestion (blue).`}
        style={{ display: "flex", alignItems: "flex-end", gap: 6 }}
      >
        {buckets.map((bucket, bi) => {
          const total = totals[bi] ?? 0;
          const barH = total === 0 ? 0 : (total / maxTotal) * BAR_HEIGHT;

          return (
            <div
              key={bucket.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                minWidth: 0,
              }}
            >
              {/* Fixed-height well — bar grows from the bottom */}
              <div
                style={{
                  width: 24,
                  height: BAR_HEIGHT,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  background: "var(--bg-elevated)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                {total > 0 && (
                  <div
                    style={{
                      height: barH,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {SEV_SEGMENTS.map(({ key, color }) => {
                      const count = bucket[key];
                      if (count === 0) return null;
                      const segH = (count / total) * barH;
                      return (
                        <div
                          key={key}
                          style={{
                            height: segH,
                            background: color,
                            flexShrink: 0,
                          }}
                          // title = tooltip text accessible to AT (numeric value)
                          title={`${key}: ${count}`}
                          aria-label={`${key}: ${count}`}
                          role="presentation"
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bucket label on x-axis */}
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  maxWidth: 36,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={bucket.label}
              >
                {bucket.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend — 3 coloured squares + labels */}
      <div
        style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}
      >
        {SEV_SEGMENTS.map(({ key, color, label }) => (
          <div
            key={key}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Visually-hidden data table for screen readers */}
      <div
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
        }}
      >
        <table>
          <caption>Severity by bucket</caption>
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              {SEV_SEGMENTS.map(({ key, label }) => (
                <th scope="col" key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{b.CRITICAL}</td>
                <td>{b.WARNING}</td>
                <td>{b.SUGGESTION}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
