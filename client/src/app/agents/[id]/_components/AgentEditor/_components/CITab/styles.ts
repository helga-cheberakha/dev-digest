import type { CSSProperties } from "react";

/** Co-located styles for CITab. */
export const s = {
  loadingWrap: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  wrap: {
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 640,
  } satisfies CSSProperties,
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    padding: "40px 24px",
    textAlign: "center",
  } satisfies CSSProperties,
  emptyH2: {
    fontSize: 18,
    fontWeight: 700,
    margin: "0 0 8px",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 14,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  headerH2: {
    fontSize: 16,
    fontWeight: 700,
    margin: 0,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,
  instList: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
  } satisfies CSSProperties,
  instRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 14,
  } satisfies CSSProperties,
  instRepoName: {
    flex: 1,
    fontWeight: 500,
  } satisfies CSSProperties,
  addRepoBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: "12px 16px",
    border: "none",
    borderTop: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-muted)",
    outline: "2px dashed var(--border-strong)",
    outlineOffset: -2,
  } satisfies CSSProperties,
  failOnCard: {
    padding: "16px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  failOnWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  failOnLabelRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  failOnLabel: {
    fontSize: 14,
    fontWeight: 600,
  } satisfies CSSProperties,
  failOnOptions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  failOnHelper: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
} as const;
