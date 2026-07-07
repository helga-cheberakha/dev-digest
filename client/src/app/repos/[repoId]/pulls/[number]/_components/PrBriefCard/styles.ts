import type { CSSProperties } from "react";

/** Co-located styles for the PR Brief Card (Why+Risk Brief rework, L05). */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,

  // ---- Banner: risk_level + what/why (AC-10) + Regenerate (AC-15) ----
  banner: (color: string, bg: string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 18,
    borderRadius: 10,
    border: `1px solid ${color}`,
    background: bg,
  }),
  bannerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  bannerBadgeRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  whatText: {
    fontSize: 15,
    fontWeight: 650,
    color: "var(--text-primary)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
  whyText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    margin: 0,
  } satisfies CSSProperties,
  regenerateError: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,

  // ---- Metrics row (AC-11) ----
  metricsRow: {
    display: "flex",
    gap: 22,
    flexWrap: "wrap",
    padding: "14px 18px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  metricItem: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  metricIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  metricCol: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  metricLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  metricValue: { fontSize: 14, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,

  // ---- No-review nudge (AC-12) ----
  nudge: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    padding: "14px 18px",
    border: "1px dashed var(--border)",
    borderRadius: 10,
  } satisfies CSSProperties,
  nudgeText: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- Review Focus list (feeds AC-14 via onOpenFile) ----
  focusSection: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  focusList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  focusItem: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  focusLabel: { fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 } satisfies CSSProperties,
  focusFileRefs: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
  focusFileRefBtn: {
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,

  // ---- shared states ----
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
