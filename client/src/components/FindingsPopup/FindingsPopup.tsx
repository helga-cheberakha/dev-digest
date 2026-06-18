"use client";

import React from "react";
import type { FindingRecord } from "@devdigest/shared";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
};

const SEV_SYMBOL: Record<string, string> = {
  CRITICAL: "⊘",
  WARNING: "△",
  SUGGESTION: "◯",
};

const CAT_COLOR: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "var(--accent)",
  style: "var(--text-muted)",
  test: "var(--text-muted)",
};

function FindingRow({ f }: { f: FindingRecord }) {
  const sevColor = SEV_COLOR[f.severity] ?? "var(--text-muted)";
  const catColor = CAT_COLOR[f.category] ?? "var(--text-muted)";
  const rationale = f.rationale.length > 100 ? f.rationale.slice(0, 100) + "…" : f.rationale;

  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: sevColor, fontWeight: 700, fontSize: 13 }}>
          {SEV_SYMBOL[f.severity] ?? "·"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0 }}>
          {f.title}
        </span>
        <span
          style={{
            fontSize: 11,
            color: catColor,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "1px 5px",
            fontWeight: 600,
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {f.category}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
        <span className="mono" style={{ color: "var(--accent-text)", flexShrink: 0 }}>
          {f.file}:{f.start_line}{f.end_line !== f.start_line ? `–${f.end_line}` : ""}
        </span>
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
          {Math.round(f.confidence * 100)}% conf
        </span>
      </div>
      {rationale && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>{rationale}</div>
      )}
    </div>
  );
}

export function FindingsPopup({
  findings,
  loading,
  anchorRect,
  onClose,
}: {
  findings?: FindingRecord[];
  loading?: boolean;
  /** Viewport-relative bounding rect of the trigger — uses fixed positioning to escape overflow:hidden containers. */
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const popupRef = React.useRef<HTMLDivElement>(null);
  const active = findings?.filter((f) => !f.dismissed_at) ?? [];

  // Close on click outside the popup
  React.useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={popupRef}
      // Stop propagation so clicks inside don't bubble to the row's onClick
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: anchorRect.bottom + 6,
        left: anchorRect.left,
        zIndex: 1000,
        width: 420,
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow-modal)",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.07em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>⚑</span>
        <span style={{ flex: 1 }}>
          {loading ? "Loading…" : `${active.length} Finding${active.length === 1 ? "" : "s"}`}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: "0 2px",
            fontSize: 14,
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {!loading && active.map((f) => <FindingRow key={f.id} f={f} />)}
      {!loading && active.length === 0 && (
        <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-muted)" }}>
          No active findings.
        </div>
      )}
    </div>
  );
}
