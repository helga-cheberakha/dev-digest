import type { CSSProperties } from "react";

/** Shared bordered-card treatment for Overview-tab sections (Intent, Blast
 *  Radius, Review Focus) so they render as matching cards. */
export const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-elevated)",
  padding: 18,
};
