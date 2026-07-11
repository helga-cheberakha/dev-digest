/* AgentEvalCard — per-agent eval metrics card. Fetches its own dashboard slice
   so the parent list can render incrementally without a waterfall. */
"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { fetchEvalDashboard, evalQueryKeys } from "@/lib/api";
import type { Agent } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Sparkline — simple SVG polyline for recall trend
// ---------------------------------------------------------------------------

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 80;
  const H = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <polyline points={coords} fill="none" stroke="var(--ok)" strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// DeltaBadge — directional arrow + signed percentage
// ---------------------------------------------------------------------------

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  const isPos = value > 0;
  return (
    <span style={{ color: isPos ? "var(--ok)" : "var(--crit)", fontSize: 11 }}>
      {isPos ? "▲" : "▼"} {isPos ? "+" : ""}
      {Math.round(value * 100)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// AgentEvalCard
// ---------------------------------------------------------------------------

interface Props {
  agent: Agent;
}

export function AgentEvalCard({ agent }: Props) {
  const t = useTranslations("eval");

  const { data, isLoading } = useQuery({
    queryKey: evalQueryKeys.dashboard(agent.id),
    queryFn: () => fetchEvalDashboard(agent.id),
  });

  const hasBatches = (data?.trend.length ?? 0) >= 1;
  const showDelta = (data?.trend.length ?? 0) >= 2;
  const recallPoints = data?.trend.map((p) => p.recall) ?? [];

  return (
    <Link
      href={`/agents/${agent.id}?tab=evals`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        background: "var(--surface)",
        transition: "border-color 0.15s",
      }}
    >
      {/* Alert banner — rendered generically for both regression and floor warnings */}
      {data?.alert && (
        <div
          role="alert"
          style={{
            background: "var(--warn-bg)",
            color: "var(--warn)",
            padding: "6px 10px",
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {data.alert}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontWeight: 600, marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {agent.name}
          </p>

          {isLoading ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("dashboard.loading")}</p>
          ) : !hasBatches ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("dashboard.noBatches")}</p>
          ) : (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {/* Recall */}
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("dashboard.metrics.recall")}
                </p>
                <p style={{ fontWeight: 600, marginBottom: 2 }}>
                  {Math.round((data?.current.recall ?? 0) * 100)}%
                </p>
                {showDelta && <DeltaBadge value={data?.delta.recall ?? 0} />}
              </div>

              {/* Precision */}
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("dashboard.metrics.precision")}
                </p>
                <p style={{ fontWeight: 600, marginBottom: 2 }}>
                  {Math.round((data?.current.precision ?? 0) * 100)}%
                </p>
                {showDelta && <DeltaBadge value={data?.delta.precision ?? 0} />}
              </div>

              {/* Citation accuracy */}
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("dashboard.metrics.citationAccuracy")}
                </p>
                <p style={{ fontWeight: 600, marginBottom: 2 }}>
                  {Math.round((data?.current.citation_accuracy ?? 0) * 100)}%
                </p>
                {showDelta && <DeltaBadge value={data?.delta.citation_accuracy ?? 0} />}
              </div>
            </div>
          )}
        </div>

        {/* Sparkline — show when at least 2 trend points exist */}
        {recallPoints.length >= 2 && <Sparkline points={recallPoints} />}
      </div>
    </Link>
  );
}
