"use client";

/* BlastGraphLightbox — portal-rendered SVG graph lightbox for the Blast Radius section.
   Derives nodes and edges from blast.downstream with correct per-symbol attribution:
   each DownstreamImpact links its symbol to its own callers and endpoints_affected only. */

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BlastRadius } from "@devdigest/shared";

export interface BlastGraphLightboxProps {
  blast: BlastRadius;
  onClose: () => void;
}

const TRUNC = 22;
const NODE_W = 130;
const NODE_H = 26;
const PAD = 48;

function truncLabel(s: string): string {
  return s.length > TRUNC ? s.slice(0, TRUNC) + "…" : s;
}

function ySpread(index: number, count: number, height: number): number {
  if (count <= 1) return height / 2;
  const span = height - PAD * 2;
  return PAD + (index * span) / (count - 1);
}

const LEGEND_ITEMS = [
  { color: "var(--accent)", label: "Symbol" },
  { color: "var(--border-strong)", label: "Caller" },
  { color: "var(--warn)", label: "Endpoint" },
] as const;

export function BlastGraphLightbox({ blast, onClose }: BlastGraphLightboxProps) {
  const t = useTranslations("blast");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const [dims, setDims] = React.useState({ width: 800, height: 560 });

  // Measure container for responsive node layout
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setDims({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial focus on open (WCAG 2.4.3)
  React.useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // ESC key to close + Tab key focus trap
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusableSelector =
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(focusableSelector),
        ).filter((el) => !(el as HTMLInputElement).disabled);
        if (focusables.length === 0) return;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const first = focusables[0]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // --- Derive nodes and edges from blast.downstream ---
  // Key correctness: per-symbol edges — never link all endpoints to the first symbol.
  const symNodes: { id: string; label: string }[] = [];
  const callerNodes: { id: string; label: string }[] = [];
  const epNodes: { id: string; label: string }[] = [];
  const edges: { from: string; to: string }[] = [];

  const symSeen = new Set<string>();
  const callerSeen = new Set<string>();
  const epSeen = new Set<string>();

  for (const d of blast.downstream) {
    const symId = `sym:${d.symbol}`;
    if (!symSeen.has(symId)) {
      symSeen.add(symId);
      symNodes.push({ id: symId, label: d.symbol });
    }
    for (const c of d.callers) {
      const callerId = `caller:${c.file}:${c.line}`;
      if (!callerSeen.has(callerId)) {
        callerSeen.add(callerId);
        callerNodes.push({ id: callerId, label: `${c.file}:${c.line}` });
      }
      edges.push({ from: symId, to: callerId });
    }
    for (const e of d.endpoints_affected) {
      const epId = `ep:${e}`;
      if (!epSeen.has(epId)) {
        epSeen.add(epId);
        epNodes.push({ id: epId, label: e });
      }
      edges.push({ from: symId, to: epId });
    }
  }

  const { width, height } = dims;
  const symX = width * 0.2;
  const callerX = width * 0.55;
  const epX = width * 0.85;

  type NodePos = { x: number; y: number; color: string; label: string };
  const pos = new Map<string, NodePos>();
  symNodes.forEach((n, i) =>
    pos.set(n.id, { x: symX, y: ySpread(i, symNodes.length, height), color: "var(--accent)", label: n.label }),
  );
  callerNodes.forEach((n, i) =>
    pos.set(n.id, { x: callerX, y: ySpread(i, callerNodes.length, height), color: "var(--border-strong)", label: n.label }),
  );
  epNodes.forEach((n, i) =>
    pos.set(n.id, { x: epX, y: ySpread(i, epNodes.length, height), color: "var(--warn)", label: n.label }),
  );

  const HALF = NODE_W / 2;

  const renderEdge = (from: string, to: string, key: string) => {
    const a = pos.get(from);
    const b = pos.get(to);
    if (!a || !b) return null;
    const mx = (a.x + b.x) / 2;
    return (
      <path
        key={key}
        d={`M${a.x + HALF},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - HALF},${b.y}`}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={1.5}
        opacity={0.5}
      />
    );
  };

  const renderNode = (id: string) => {
    const n = pos.get(id);
    if (!n) return null;
    return (
      <g key={id} transform={`translate(${n.x - HALF},${n.y - NODE_H / 2})`}>
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--bg-surface)" stroke={n.color} strokeWidth={1.5} />
        <text x={NODE_W / 2} y={17} textAnchor="middle" fontSize={11} fill="var(--text-primary)" className="mono">
          {truncLabel(n.label)}
        </text>
      </g>
    );
  };

  const dialog = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("graphTitle")}
        style={{
          position: "relative",
          width: "90vw",
          height: "90vh",
          borderRadius: 12,
          background: "var(--bg-elevated)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 16,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
            zIndex: 1,
          }}
        >
          {t("graphTitle")}
        </div>

        {/* Close button */}
        <button
          ref={closeButtonRef}
          aria-label={t("closeGraph")}
          onClick={onClose}
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            zIndex: 1,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
            color: "var(--text-primary)",
          }}
        >
          <Icon.X size={16} />
        </button>

        {/* SVG canvas — fills the dialog; ResizeObserver tracks actual pixel dimensions */}
        <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
          <svg width={width} height={height}>
            {edges.map((e, i) => renderEdge(e.from, e.to, `e-${i}`))}
            {[...pos.keys()].map(renderNode)}
          </svg>
        </div>

        {/* Legend — bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          {LEGEND_ITEMS.map(({ color, label }) => (
            <span
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
