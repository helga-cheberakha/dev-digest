/*
 * StatsTab — per-agent quality metrics tab in the Agent Editor.
 * Shows runs/accept-rate/cost/latency metric cards, a findings-by-severity
 * breakdown, a run-trend list, category donut, and a paginated run history table
 * with a trace drawer for the selected time window.
 */
"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Skeleton, SectionLabel, CircularScore } from "@devdigest/ui";
import { useAgentStats, useAgentRuns } from "@/lib/hooks/agentPerformance";
import { formatCost } from "@/lib/cost";
import type { PerfWindow } from "@/lib/api";
import type { StatPoint } from "@devdigest/shared";
import RunTraceDrawer from "@/components/RunTraceDrawer";
import { Sparkline } from "./_components/Sparkline";
import { CostDelta } from "./_components/CostDelta";
import { SeverityStackedBars } from "./_components/SeverityStackedBars";
import { CategoryDonut } from "./_components/CategoryDonut";
import { RunHistoryTable } from "./_components/RunHistoryTable";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctOrNoData(
  value: number | null | undefined,
  noDataGlyph: string,
): string {
  if (value == null) return noDataGlyph;
  return `${(value * 100).toFixed(0)}%`;
}

function latencyDisplay(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${Math.round(ms)} ms`;
}

// ---------------------------------------------------------------------------
// Card — shared bordered-panel style reused by metric cards, findings cards,
// and the run-trend panel so the tab reads as one consistent design system.
// ---------------------------------------------------------------------------

const CARD_STYLE: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 9,
  padding: "14px 16px",
};

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  isNoData,
  noDataLabel,
  extra,
  badge,
}: {
  label: string;
  value: string;
  /** When true, renders the value with the "no data" visual treatment. */
  isNoData?: boolean;
  noDataLabel?: string;
  /** Optional content rendered below the main value (e.g. a sparkline). */
  extra?: React.ReactNode;
  /** Optional ring badge rendered in the card's top-right corner (e.g. accept-rate gauge). */
  badge?: React.ReactNode;
}) {
  return (
    <div style={{ ...CARD_STYLE, position: "relative", flex: 1 }}>
      {badge != null && (
        <div style={{ position: "absolute", top: 12, right: 12 }}>{badge}</div>
      )}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 8 }}>
        {isNoData ? (
          <span
            role="img"
            aria-label={noDataLabel ?? "no data"}
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: "0.05em",
            }}
          >
            {value}
          </span>
        ) : (
          <span
            className="tnum"
            style={{ fontSize: 26, fontWeight: 700, color: "var(--accent)" }}
          >
            {value}
          </span>
        )}
      </div>
      {extra != null && <div style={{ marginTop: 8 }}>{extra}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period selector
// ---------------------------------------------------------------------------

type PresetPeriod = "1d" | "30d";

function PeriodSelector({
  window,
  onChange,
  labels,
}: {
  window: PerfWindow;
  onChange: (w: PerfWindow) => void;
  labels: { "1d": string; "30d": string; custom: string; apply: string };
}) {
  const isCustom = window.period === "custom";
  // Whether the custom date inputs are revealed — separate from `isCustom` so
  // clicking "Custom" opens the inputs WITHOUT firing onChange; the query only
  // fires once the user explicitly clicks Apply with both dates filled in.
  const [customOpen, setCustomOpen] = useState(isCustom);
  const [customFrom, setCustomFrom] = useState(
    isCustom ? window.from : "",
  );
  const [customTo, setCustomTo] = useState(
    isCustom ? window.to : "",
  );

  // Narrowed once so the effect deps below can reference plain identifiers
  // instead of conditional expressions (window.from/to only exist on the
  // "custom" variant of PerfWindow).
  const windowFrom = isCustom ? window.from : undefined;
  const windowTo = isCustom ? window.to : undefined;

  // Keep internal state in sync when the parent switches `window` away from
  // (or between) custom ranges out-of-band — e.g. a preset button elsewhere,
  // or a reset action — so stale dates/an open panel don't linger.
  useEffect(() => {
    setCustomOpen(isCustom);
  }, [isCustom]);

  useEffect(() => {
    if (windowFrom !== undefined && windowTo !== undefined) {
      setCustomFrom(windowFrom);
      setCustomTo(windowTo);
    }
  }, [windowFrom, windowTo]);

  const presets: PresetPeriod[] = ["30d", "1d"];
  const showCustomInputs = isCustom || customOpen;

  function handleApply() {
    if (customFrom && customTo) {
      onChange({ period: "custom", from: customFrom, to: customTo });
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {presets.map((p) => (
        <button
          key={p}
          onClick={() => {
            setCustomOpen(false);
            onChange({ period: p });
          }}
          style={{
            padding: "4px 10px",
            borderRadius: 5,
            border: "1px solid var(--border)",
            background:
              window.period === p ? "var(--accent)" : "var(--bg-elevated)",
            color:
              window.period === p ? "#fff" : "var(--text-primary)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {labels[p]}
        </button>
      ))}
      <button
        onClick={() => setCustomOpen(true)}
        style={{
          padding: "4px 10px",
          borderRadius: 5,
          border: "1px solid var(--border)",
          background: showCustomInputs ? "var(--accent)" : "var(--bg-elevated)",
          color: showCustomInputs ? "#fff" : "var(--text-primary)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {labels.custom}
      </button>
      {showCustomInputs && (
        <>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <button
            onClick={handleApply}
            disabled={!customFrom || !customTo}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: customFrom && customTo ? "var(--accent)" : "var(--bg-hover)",
              color: customFrom && customTo ? "#fff" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: customFrom && customTo ? "pointer" : "not-allowed",
              opacity: customFrom && customTo ? 1 : 0.5,
            }}
          >
            {labels.apply}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend list (uses both label + value from StatPoint)
// ---------------------------------------------------------------------------

/**
 * StatPoint.label arrives as a raw ISO timestamp (server sends `ranAt.toISOString()`
 * unformatted — see server/src/modules/agent-performance/service.ts). Format it as
 * a short absolute date/time here rather than showing the raw ISO string.
 * Pinned to UTC so the label is identical regardless of the viewer's local timezone.
 */
function formatTrendLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return `${date} ${time}`;
}

function TrendList({ points, title }: { points: StatPoint[]; title: string }) {
  if (points.length === 0) return null;

  const maxVal = Math.max(...points.map((p) => p.value), 1);

  return (
    <div style={{ ...CARD_STYLE, marginBottom: 28 }}>
      <SectionLabel icon="TrendingUp">{title}</SectionLabel>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 14,
        }}
      >
        {points.map((pt, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            <span
              title={pt.label}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                width: 104,
                flexShrink: 0,
                fontFamily: "monospace",
              }}
            >
              {formatTrendLabel(pt.label)}
            </span>
            <div
              style={{
                flex: 1,
                height: 8,
                background: "var(--bg-hover)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${(pt.value / maxVal) * 100}%`,
                  height: "100%",
                  background: "var(--accent)",
                  borderRadius: 4,
                }}
              />
            </div>
            <span
              className="tnum"
              style={{ fontSize: 12, color: "var(--text-secondary)", width: 28, textAlign: "right", flexShrink: 0 }}
            >
              {pt.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StatsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const [window, setWindow] = useState<PerfWindow>({ period: "30d" });
  const [page, setPage] = useState(1);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  // Reset page to 1 whenever the time window changes so the user
  // doesn't land on a page that doesn't exist in the new window's data.
  const handleWindowChange = (w: PerfWindow) => {
    setWindow(w);
    setPage(1);
  };

  const { data, isLoading, isError } = useAgentStats(agentId, window);

  // Independent query for run history — scoped error state so a run-list
  // failure doesn't blank the stats/chart sections above it.
  const {
    data: runsData,
    isLoading: runsLoading,
    isError: runsError,
  } = useAgentRuns(agentId, window, page, 25);

  const periodLabels = {
    "1d": t("stats.window.1d"),
    "30d": t("stats.window.30d"),
    custom: t("stats.window.custom"),
    apply: t("stats.window.apply"),
  };

  const noDataGlyph = t("stats.noData");
  const noDataLabel = t("stats.noAcceptRateLabel");

  return (
    <div style={{ maxWidth: 1040, paddingBottom: 40 }}>
      {/* ── Period selector ── */}
      <div style={{ marginBottom: 20 }}>
        <PeriodSelector
          window={window}
          onChange={handleWindowChange}
          labels={periodLabels}
        />
      </div>

      {/* ── Loading state ── */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Skeleton height={80} style={{ flex: 1 }} />
            <Skeleton height={80} style={{ flex: 1 }} />
            <Skeleton height={80} style={{ flex: 1 }} />
            <Skeleton height={80} style={{ flex: 1 }} />
          </div>
          <Skeleton height={120} />
        </div>
      )}

      {/* ── Error state ── */}
      {!isLoading && isError && (
        <p style={{ fontSize: 13, color: "var(--crit)" }}>
          {t("stats.errorState")}
        </p>
      )}

      {/* ── Data ── */}
      {!isLoading && !isError && data && (
        <>
          {/* Empty state: zero runs — cards/trend hidden, new blocks still render */}
          {data.runs === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("stats.emptyState")}
            </p>
          ) : (
            <>
              {/* ── Metric cards ── */}
              <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
                {/* RUNS — with inline Sparkline (guarded for length-1 NaN per INSIGHTS 2026-07-11) */}
                <MetricCard
                  label={t("stats.tiles.runs")}
                  value={String(data.runs)}
                  extra={
                    data.trend.length >= 2 ? (
                      <Sparkline points={data.trend} />
                    ) : undefined
                  }
                />
                {/* ACCEPT RATE — corner ring badge, same pattern as the
                    Agent Performance page's SummaryCards (reused here rather
                    than a separate full-size gauge stacked below the value). */}
                <MetricCard
                  label={t("stats.tiles.acceptRate")}
                  value={
                    data.accept_rate == null
                      ? noDataGlyph
                      : pctOrNoData(data.accept_rate, noDataGlyph)
                  }
                  isNoData={data.accept_rate == null}
                  noDataLabel={noDataLabel}
                  badge={
                    data.accept_rate != null ? (
                      <CircularScore
                        score={Math.round(data.accept_rate * 100)}
                        size={36}
                        stroke={3}
                      />
                    ) : undefined
                  }
                />
                {/* AVG COST — augmented with delta vs prior window */}
                <MetricCard
                  label={t("stats.tiles.avgCost")}
                  value={formatCost(data.avg_cost_usd)}
                  extra={
                    <CostDelta
                      current={data.avg_cost_usd}
                      previous={data.avg_cost_usd_prev}
                    />
                  }
                />
                {/* AVG LATENCY — unchanged */}
                <MetricCard
                  label={t("stats.tiles.avgLatency")}
                  value={latencyDisplay(data.avg_latency_ms)}
                />
              </div>

              {/* ── Run trend ── */}
              {data.trend.length >= 2 && (
                <TrendList
                  points={data.trend}
                  title={t("stats.trendTitle")}
                />
              )}
            </>
          )}

          {/* ──────────────────────────────────────────────────────────────── */}
          {/* The sections below render for ALL windows (including zero runs). */}
          {/* Each T5 component handles empty arrays / null gracefully.        */}
          {/* ──────────────────────────────────────────────────────────────── */}

          {/* ── Findings by severity + Findings by category — side-by-side
                cards, same CARD_STYLE panel as the metric cards above ── */}
          <div
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <div style={{ ...CARD_STYLE, flex: 1, minWidth: 280 }}>
              <SectionLabel icon="AlertTriangle">
                {t("stats.findingsBySeverity")}
              </SectionLabel>
              <div style={{ marginTop: 14 }}>
                <SeverityStackedBars buckets={data.severity_by_bucket} />
              </div>
            </div>

            <div style={{ ...CARD_STYLE, flex: 1, minWidth: 280 }}>
              <SectionLabel icon="BarChart">
                {t("stats.findingsByCategory")}
              </SectionLabel>
              <div style={{ marginTop: 14 }}>
                <CategoryDonut costByCategory={data.cost_by_category} />
              </div>
            </div>
          </div>

          {/* ── Run History — own independent loading/error state ── */}
          <SectionLabel icon="History">
            {t("stats.runHistory")}
          </SectionLabel>
          <div style={{ marginBottom: 28 }}>
            {runsLoading ? (
              <Skeleton height={80} />
            ) : runsError ? (
              <p style={{ fontSize: 13, color: "var(--crit)", margin: 0 }}>
                {t("stats.runsErrorState")}
              </p>
            ) : (
              <RunHistoryTable
                rows={runsData?.rows ?? []}
                onViewTrace={(row) => setOpenRunId(row.run_id)}
                page={page}
                limit={25}
                total={runsData?.total ?? 0}
                onPageChange={setPage}
              />
            )}
          </div>

          {/* ── Run Trace Drawer — opens when a table row's trace action is clicked ── */}
          {openRunId != null && (
            <RunTraceDrawer
              runId={openRunId}
              agentName={data.agent_name}
              onClose={() => setOpenRunId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
