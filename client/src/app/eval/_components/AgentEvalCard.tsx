/* AgentEvalCard — per-agent eval metrics card. Fetches its own dashboard slice
   so the parent list can render incrementally without a waterfall. The parent
   passes down its already-fetched batch history (`batches`) purely to source
   the "Last run vN · date" line — no extra fetch happens here. */
"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Icon, Badge } from "@devdigest/ui";
import { fetchEvalDashboard, evalQueryKeys } from "@/lib/api";
import type { Agent, EvalRunBatch } from "@devdigest/shared";

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
      <polyline points={coords} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stat — a labeled, colored metric value in the card's right-hand cluster
// ---------------------------------------------------------------------------

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: "center", minWidth: 44 }}>
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
          margin: "0 0 2px",
        }}
      >
        {label}
      </p>
      <p className="tnum" style={{ fontSize: 15, fontWeight: 700, color, margin: 0 }}>
        {Math.round(value * 100)}%
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentEvalCard
// ---------------------------------------------------------------------------

interface Props {
  agent: Agent;
  batches?: EvalRunBatch[];
}

export function AgentEvalCard({ agent, batches }: Props) {
  const t = useTranslations("eval");

  const { data, isLoading } = useQuery({
    queryKey: evalQueryKeys.dashboard(agent.id),
    queryFn: () => fetchEvalDashboard(agent.id),
  });

  const hasBatches = (data?.trend.length ?? 0) >= 1;
  const recallPoints = data?.trend.map((p) => p.recall) ?? [];
  const latestBatch = batches?.[0];

  const lastRunLabel =
    latestBatch != null && data
      ? t("dashboard.lastRun", {
          version: latestBatch.agent_version ?? "—",
          date: new Date(latestBatch.ran_at).toLocaleString(),
          passed: data.current.traces_passed,
          total: data.current.traces_total,
        })
      : null;

  return (
    <Link
      href={`/eval/${agent.id}`}
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

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Agent icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--accent-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Cpu size={18} style={{ color: "var(--accent)" }} />
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              style={{
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {agent.name}
            </span>
            {agent.model && <Badge mono>{agent.model}</Badge>}
          </div>

          {isLoading ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
              {t("dashboard.loading")}
            </p>
          ) : !hasBatches ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
              {t("dashboard.noBatches")}
            </p>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>{lastRunLabel}</p>
          )}
        </div>

        {/* Sparkline + stats + chevron — only once real metrics exist */}
        {hasBatches && (
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
            {recallPoints.length >= 2 && <Sparkline points={recallPoints} />}
            <Stat
              label={t("dashboard.metrics.recall")}
              value={data?.current.recall ?? 0}
              color="var(--accent)"
            />
            <Stat
              label={t("dashboard.metrics.precision")}
              value={data?.current.precision ?? 0}
              color="var(--ok)"
            />
            <Stat
              label={t("dashboard.metrics.citationAccuracy")}
              value={data?.current.citation_accuracy ?? 0}
              color="var(--warn)"
            />
            <Icon.ChevronRight size={18} style={{ color: "var(--text-muted)" }} />
          </div>
        )}
      </div>
    </Link>
  );
}
