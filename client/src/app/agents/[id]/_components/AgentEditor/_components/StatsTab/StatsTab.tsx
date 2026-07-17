/*
 * StatsTab — per-agent quality metrics tab in the Agent Editor.
 * Shows runs/accept-rate/cost/latency metric cards, a findings-by-severity
 * breakdown, a run-trend list, category donut, and a paginated run history table
 * with a trace drawer for the selected time window.
 */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Skeleton, SectionLabel } from "@devdigest/ui";
import { useAgentStats, useAgentRuns } from "@/lib/hooks/agentPerformance";
import { formatCost } from "@/lib/cost";
import type { PerfWindow } from "@/lib/api";
import type { StatPoint } from "@devdigest/shared";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { Sparkline } from "./_components/Sparkline";
import { AcceptRateGauge } from "./_components/AcceptRateGauge";
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
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  isNoData,
  noDataLabel,
  extra,
}: {
  label: string;
  value: string;
  /** When true, renders the value with the "no data" visual treatment. */
  isNoData?: boolean;
  noDataLabel?: string;
  /** Optional content rendered below the main value (overlay/augmentation). */
  extra?: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: "14px 16px",
      }}
    >
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
  labels: { "1d": string; "30d": string; custom: string };
}) {
  const [customFrom, setCustomFrom] = useState(
    window.period === "custom" ? window.from : "",
  );
  const [customTo, setCustomTo] = useState(
    window.period === "custom" ? window.to : "",
  );

  const presets: PresetPeriod[] = ["30d", "1d"];
  const isCustom = window.period === "custom";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {presets.map((p) => (
        <button
          key={p}
          onClick={() => onChange({ period: p })}
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
        onClick={() => {
          const from = customFrom || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
          const to = customTo || new Date().toISOString().slice(0, 10);
          onChange({ period: "custom", from, to });
        }}
        style={{
          padding: "4px 10px",
          borderRadius: 5,
          border: "1px solid var(--border)",
          background: isCustom ? "var(--accent)" : "var(--bg-elevated)",
          color: isCustom ? "#fff" : "var(--text-primary)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {labels.custom}
      </button>
      {isCustom && (
        <>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              if (e.target.value && customTo) {
                onChange({ period: "custom", from: e.target.value, to: customTo });
              }
            }}
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
            onChange={(e) => {
              setCustomTo(e.target.value);
              if (customFrom && e.target.value) {
                onChange({ period: "custom", from: customFrom, to: e.target.value });
              }
            }}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend list (uses both label + value from StatPoint)
// ---------------------------------------------------------------------------

function TrendList({ points, title }: { points: StatPoint[]; title: string }) {
  if (points.length === 0) return null;

  const maxVal = Math.max(...points.map((p) => p.value), 1);

  return (
    <div>
      <SectionLabel icon="TrendingUp">{title}</SectionLabel>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 24,
        }}
      >
        {points.map((pt, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                width: 90,
                flexShrink: 0,
                fontFamily: "monospace",
              }}
            >
              {pt.label}
            </span>
            <div
              style={{
                flex: 1,
                height: 8,
                background: "var(--bg-elevated)",
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
                {/* ACCEPT RATE — augmented with radial gauge */}
                <MetricCard
                  label={t("stats.tiles.acceptRate")}
                  value={
                    data.accept_rate == null
                      ? noDataGlyph
                      : pctOrNoData(data.accept_rate, noDataGlyph)
                  }
                  isNoData={data.accept_rate == null}
                  noDataLabel={noDataLabel}
                  extra={<AcceptRateGauge acceptRate={data.accept_rate} />}
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

          {/* ── Findings by severity (replaces flat severity boxes) ── */}
          <SectionLabel icon="AlertTriangle">
            {t("stats.findingsBySeverity")}
          </SectionLabel>
          <div style={{ marginBottom: 28 }}>
            <SeverityStackedBars buckets={data.severity_by_bucket} />
          </div>

          {/* ── Findings by Category ── */}
          <SectionLabel icon="BarChart">
            {t("stats.findingsByCategory")}
          </SectionLabel>
          <div style={{ marginBottom: 28 }}>
            <CategoryDonut costByCategory={data.cost_by_category} />
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
