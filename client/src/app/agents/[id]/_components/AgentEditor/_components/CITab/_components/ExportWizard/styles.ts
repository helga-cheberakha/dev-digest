import type { CSSProperties } from "react";

/** Co-located styles for ExportWizard shell. */
export const s = {
  stepperWrap: {
    padding: "16px 24px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  stepBody: {
    flex: 1,
    overflow: "auto",
  } satisfies CSSProperties,
  footerSuccess: {
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  footerNormal: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } satisfies CSSProperties,
} as const;
