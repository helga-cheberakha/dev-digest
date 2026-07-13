/* Tooltip — lightweight hover label for explaining a disabled/muted control.
   Not the native `title` attribute: browsers apply their own ~1s show delay
   to `title`, and a genuinely `disabled` <button> doesn't reliably fire mouse
   events in Firefox/Safari at all, so a `title` on a disabled button can
   silently never show. This wraps children in a plain (never-disabled) span
   that owns the hover detection instead, with a short, fixed show delay. */
"use client";

import React from "react";

const SHOW_DELAY_MS = 80;

export function Tooltip({
  label,
  children,
}: {
  /** Omit or pass undefined to render children with no tooltip behavior. */
  label?: string;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  React.useEffect(() => clearTimer, []);

  if (!label) return <>{children}</>;

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => {
        clearTimer();
        timer.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearTimer();
        setVisible(false);
      }}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            fontSize: 12,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
