"use client";

/**
 * AgentPerfTable — sortable, expandable per-agent performance table.
 *
 * Acceptance rules:
 *   - Default sort: accept_rate DESC, null-accept-rate rows always LAST.
 *   - Clicking any sortable column header re-sorts CLIENT-SIDE (no network call).
 *   - Each row has a disclosure toggle; expanding shows the inline trend sparkline.
 *   - "View" button calls injected onView(agentId) — no navigation here.
 *   - Null-safe cells: runs=0 → "0", avg_cost_usd=null → "—",
 *     accept_rate=null → NO_DATA_GLYPH ("—").
 *   - React key = row.agent_id (not array index — rows re-sort).
 *   - accept_rate coloring pairs a glyph (↑/~/↓) with the numeric % for WCAG AA.
 */

import React, { useState } from "react";
import type { AgentPerfRow } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { formatTimeAgo } from "@/lib/time-ago";
import { NO_DATA_GLYPH } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type SortKey =
  | "agent_name"
  | "runs"
  | "avg_cost_usd"
  | "avg_latency_ms"
  | "accept_rate"
  | "last_run_at";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentPerfTableProps {
  rows: AgentPerfRow[];
  onView: (agentId: string) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Sort rows by the given key, placing null values LAST regardless of direction.
 * Returns a new array (does not mutate the input).
 */
export function sortRows(
  rows: AgentPerfRow[],
  key: SortKey,
  dir: SortDir,
): AgentPerfRow[] {
  return [...rows].sort((a, b) => {
    const av: string | number | null = a[key] as string | number | null;
    const bv: string | number | null = b[key] as string | number | null;

    // Nulls always last, regardless of sort direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;

    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "desc" ? -cmp : cmp;
  });
}

/** Format avg_latency_ms as a human-readable string. */
function formatLatency(ms: number | null): string {
  if (ms === null) return NO_DATA_GLYPH;
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Accept-rate cell: pairs a directional glyph with the numeric % for WCAG AA
 * (meaning is not conveyed by colour alone).
 */
function AcceptRateCell({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <span style={{ color: "var(--text-muted)" }} aria-label="no data">
        {NO_DATA_GLYPH}
      </span>
    );
  }
  const pct = Math.round(rate * 100);
  const { color, glyph } =
    rate >= 0.7
      ? { color: "var(--ok)", glyph: "↑" }
      : rate >= 0.4
        ? { color: "var(--warn)", glyph: "~" }
        : { color: "var(--crit)", glyph: "↓" };
  return (
    <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
      {glyph} {pct}%
    </span>
  );
}

/**
 * Simple bar-strip sparkline rendered as inline SVG-free divs.
 * Guards against length < 1 and NaN (vendor Sparkline has a ÷0 bug at length 1).
 */
function TrendBars({ trend }: { trend: number[] }) {
  if (trend.length === 0) {
    return (
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{NO_DATA_GLYPH}</span>
    );
  }
  const max = Math.max(...trend, 1); // avoid div-by-zero
  return (
    <div
      aria-label="trend sparkline"
      style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 28, paddingTop: 4 }}
    >
      {trend.map((v, i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: `${Math.max(Math.round((v / max) * 100), 7)}%`,
            background: "var(--accent)",
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

/** Column header button: shows a sort indicator when active. */
function ColHeader({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: SortKey | null;
  current: SortState;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey !== null && current.key === sortKey;
  const indicator = isActive ? (current.dir === "desc" ? " ↓" : " ↑") : "";

  if (sortKey === null) {
    return (
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          padding: "0 8px 8px 8px",
        }}
      >
        {label}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 700,
        color: isActive ? "var(--text-primary)" : "var(--text-muted)",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        padding: "0 8px 8px 8px",
        whiteSpace: "nowrap",
      }}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {indicator}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentPerfTable({ rows, onView }: AgentPerfTableProps) {
  const [sort, setSort] = useState<SortState>({ key: "accept_rate", dir: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }

  function toggleExpand(agentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  const sorted = sortRows(rows, sort.key, sort.dir);

  // ---------------------------------------------------------------------------
  // Shared column header style
  // ---------------------------------------------------------------------------
  const headerStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "32px 1fr 72px 88px 72px 80px 80px 60px",
    alignItems: "end",
    borderBottom: "1px solid var(--border)",
    paddingBottom: 0,
  };

  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "32px 1fr 72px 88px 72px 80px 80px 60px",
    alignItems: "center",
    borderBottom: "1px solid var(--border)",
    padding: "8px 0",
    gap: 0,
    cursor: "pointer",
  };

  const cellStyle: React.CSSProperties = {
    padding: "0 8px",
    fontSize: 13,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  };

  const mutedCell: React.CSSProperties = {
    ...cellStyle,
    color: "var(--text-muted)",
  };

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      {/* Header row */}
      <div style={headerStyle} role="row">
        <div /> {/* expand toggle column — no header */}
        <ColHeader label="Agent" sortKey="agent_name" current={sort} onSort={handleSort} />
        <ColHeader label="Runs" sortKey="runs" current={sort} onSort={handleSort} />
        <ColHeader label="Avg cost" sortKey="avg_cost_usd" current={sort} onSort={handleSort} />
        <ColHeader label="Avg dur." sortKey="avg_latency_ms" current={sort} onSort={handleSort} />
        <ColHeader label="Accept" sortKey="accept_rate" current={sort} onSort={handleSort} />
        <ColHeader label="Last run" sortKey="last_run_at" current={sort} onSort={handleSort} />
        <ColHeader label="View" sortKey={null} current={sort} onSort={handleSort} />
      </div>

      {/* Data rows */}
      {sorted.map((row) => {
        const isExpanded = expanded.has(row.agent_id);
        return (
          <div key={row.agent_id}>
            {/* Main row — clicking anywhere on the row navigates; the
                disclosure toggle and View button stop propagation so they
                do not double-fire. */}
            <div style={rowStyle} role="row" onClick={() => onView(row.agent_id)}>
              {/* Disclosure toggle — onClick lives on the wrapper so that clicks
                  landing in the padding area (just outside the button icon) are
                  also captured and do not bubble up to the row's navigation handler. */}
              <div
                style={{ padding: "0 4px" }}
                onClick={(e) => { e.stopPropagation(); toggleExpand(row.agent_id); }}
                data-testid={`disclosure-wrapper-${row.agent_id}`}
              >
                <button
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Collapse row" : "Expand row"}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontSize: 10,
                    padding: 4,
                    lineHeight: 1,
                  }}
                >
                  {isExpanded ? "▼" : "▶"}
                </button>
              </div>

              {/* Agent name + model */}
              <div style={{ padding: "0 8px" }}>
                <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
                  {row.agent_name}
                </div>
                {row.model && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {row.model}
                  </div>
                )}
              </div>

              {/* Runs — 0 renders as "0", not "—" (zero runs is a real value) */}
              <div style={cellStyle}>{row.runs}</div>

              {/* Avg cost */}
              <div style={cellStyle}>{formatCost(row.avg_cost_usd)}</div>

              {/* Avg duration */}
              <div style={cellStyle}>{formatLatency(row.avg_latency_ms)}</div>

              {/* Accept rate */}
              <div style={cellStyle}>
                <AcceptRateCell rate={row.accept_rate} />
              </div>

              {/* Last run */}
              <div style={mutedCell}>
                {row.last_run_at ? formatTimeAgo(row.last_run_at) : NO_DATA_GLYPH}
              </div>

              {/* View button — stop propagation so the row-level onClick
                  does not fire a second time when the button is clicked */}
              <div style={{ padding: "0 8px" }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onView(row.agent_id); }}
                  aria-label={`View ${row.agent_name}`}
                  style={{
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    cursor: "pointer",
                    color: "var(--accent-text)",
                    fontSize: 12,
                    padding: "3px 8px",
                  }}
                >
                  View
                </button>
              </div>
            </div>

            {/* Expanded: inline trend */}
            {isExpanded && (
              <div
                style={{
                  padding: "8px 8px 8px 40px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                }}
                data-testid={`trend-${row.agent_id}`}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Findings / run trend (recent →)
                </div>
                <TrendBars trend={row.trend} />
              </div>
            )}
          </div>
        );
      })}

      {sorted.length === 0 && (
        <div
          style={{
            padding: "24px 8px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          No agent runs yet.
        </div>
      )}
    </div>
  );
}
