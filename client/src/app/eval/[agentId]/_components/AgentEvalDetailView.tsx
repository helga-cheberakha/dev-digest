/* AgentEvalDetailView — per-agent Eval Dashboard drill-down (breadcrumb
   Skills Lab › Eval Dashboard › <agent>). Distinct from the Agent Editor's
   "Evals" tab (case management) — this is the regression-harness dashboard:
   metric cards + trend chart + run history with 2-of-N compare. */
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Skeleton, ErrorState, Button, SectionLabel, Dropdown, Icon, Badge, MetricCard, LineChart } from "@devdigest/ui";
import { useAgents, useAgent } from "@/lib/hooks/agents";
import { fetchEvalDashboard, fetchEvalBatches, runEvalBatch, evalQueryKeys } from "@/lib/api";
import { formatCost } from "@/lib/cost";
import { ApiError } from "@/lib/api";
import type { EvalRunBatch } from "@devdigest/shared";
import { MetricBar } from "../../_components/MetricBar";
import { CompareRunsModal } from "./CompareRunsModal";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  page: { padding: "24px", maxWidth: 1200, margin: "0 auto" } as const,
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 13,
    color: "var(--text-secondary)",
    textDecoration: "none",
    marginBottom: 16,
  } as const,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } as const,
  h1: { fontSize: 24, fontWeight: 700, margin: 0 } as const,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "0 0 20px" } as const,
  controlsRow: { display: "flex", alignItems: "center", gap: 20, marginBottom: 20 } as const,
  controls: { display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" } as const,
  metricRow: { display: "flex", gap: 14, marginBottom: 28 } as const,
  chartCard: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 18,
    marginBottom: 32,
  } as const,
  legend: { display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" } as const,
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: {
    textAlign: "left" as const,
    padding: "6px 12px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontWeight: 500,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  td: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-subtle, var(--border))",
    color: "var(--text-primary)",
  },
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </span>
  );
}

const DATE_RANGES = [7, 30, 90, null] as const;

// ---------------------------------------------------------------------------
// AgentEvalDetailView
// ---------------------------------------------------------------------------

export function AgentEvalDetailView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const qc = useQueryClient();

  const { data: agent, isLoading: agentLoading, isError: agentIsError, error: agentError, refetch: refetchAgent } =
    useAgent(agentId);
  const { data: agents } = useAgents();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: evalQueryKeys.dashboard(agentId),
    queryFn: () => fetchEvalDashboard(agentId),
  });

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: evalQueryKeys.batches(agentId),
    queryFn: () => fetchEvalBatches(agentId),
  });

  // Default to "All time" — a narrower default (e.g. 30 days) would silently
  // hide older-but-real batch history behind an unlabeled empty state on first load.
  const [dateRangeDays, setDateRangeDays] = useState<number | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [runningEval, setRunningEval] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const cutoff = dateRangeDays != null ? Date.now() - dateRangeDays * 86400000 : null;
  const filteredBatches = (batches ?? []).filter(
    (b) => cutoff == null || new Date(b.ran_at).getTime() >= cutoff,
  );
  const filteredTrend = (dashboard?.trend ?? []).filter(
    (p) => cutoff == null || new Date(p.ran_at).getTime() >= cutoff,
  );

  function toggleSelect(batchId: string) {
    setSelectedBatchIds((prev) => {
      if (prev.includes(batchId)) return prev.filter((id) => id !== batchId);
      if (prev.length < 2) return [...prev, batchId];
      return [prev[1]!, batchId];
    });
  }

  async function handleRunEval() {
    if (runningEval) return;
    setRunningEval(true);
    setRunError(null);
    try {
      await runEvalBatch(agentId);
      void qc.invalidateQueries({ queryKey: evalQueryKeys.dashboard(agentId) });
      void qc.invalidateQueries({ queryKey: evalQueryKeys.batches(agentId) });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRunningEval(false);
    }
  }

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agent?.name ?? "" },
  ];

  if (agentIsError || (!agentLoading && !agent)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn’t load this agent"
          body={agentError instanceof ApiError ? agentError.message : "The agent could not be loaded."}
          onRetry={() => refetchAgent()}
        />
      </AppShell>
    );
  }

  const selected = filteredBatches.filter((b) => selectedBatchIds.includes(b.batch_id));
  const [oldBatch, newBatch] =
    selected.length === 2
      ? [...selected].sort((a, b) => new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime())
      : [undefined, undefined];

  const hasBatches = (batches?.length ?? 0) > 0;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <Link href="/eval" style={s.backLink}>
          <Icon.ChevronLeft size={14} />
          {t("detail.backToAgents")}
        </Link>

        {agentLoading || !agent ? (
          <>
            <Skeleton height={28} width={280} />
            <div style={{ marginTop: 20 }}>
              <Skeleton height={200} />
            </div>
          </>
        ) : (
          <>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{agent.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {agent.model}
              </Badge>
            </div>
            <p style={s.subtitle}>
              {t("detail.subtitle", { runs: batches?.length ?? 0, cases: dashboard?.cases_total ?? 0 })}
            </p>

            <div style={s.controlsRow}>
              <div style={s.controls}>
                <Dropdown
                  align="right"
                  trigger={
                    <Button kind="secondary" size="sm" icon="Cpu" iconRight="ChevronDown">
                      {agent.name}
                    </Button>
                  }
                  items={(agents ?? [])
                    .filter((a) => a.id !== agentId)
                    .map((a) => ({
                      label: a.name,
                      icon: "Cpu" as const,
                      onClick: () => router.push(`/eval/${a.id}`),
                    }))}
                />
                <Dropdown
                  align="right"
                  trigger={
                    <Button kind="secondary" size="sm" icon="Calendar">
                      {dateRangeDays != null
                        ? t(`detail.dateRange.${dateRangeDays}` as "detail.dateRange.30")
                        : t("detail.dateRange.all")}
                    </Button>
                  }
                  items={DATE_RANGES.map((d) => ({
                    label: d != null ? t(`detail.dateRange.${d}` as "detail.dateRange.30") : t("detail.dateRange.all"),
                    onClick: () => setDateRangeDays(d),
                  }))}
                />
                <Button
                  kind="primary"
                  icon="Play"
                  loading={runningEval}
                  disabled={runningEval}
                  onClick={() => void handleRunEval()}
                >
                  {runningEval ? t("detail.running") : t("detail.runEval")}
                </Button>
              </div>
            </div>

            {runError && (
              <div
                role="alert"
                style={{
                  color: "var(--crit)",
                  fontSize: 13,
                  marginBottom: 16,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--crit)",
                }}
              >
                {runError}
              </div>
            )}

            {dashboard?.alert && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--warn-bg)",
                  color: "var(--warn)",
                  padding: "10px 14px",
                  borderRadius: 6,
                  marginBottom: 20,
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <Icon.AlertTriangle size={15} style={{ flexShrink: 0 }} />
                {dashboard.alert}
              </div>
            )}

            {batchesLoading || dashboardLoading ? (
              <Skeleton height={300} />
            ) : !hasBatches ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("detail.noBatches")}</p>
            ) : (
              <>
                {/* Sparkline divides by (points.length - 1) — only pass trend once
                    there are ≥2 points, or a single-run agent renders NaN path data. */}
                {(() => {
                  const hasSparkline = filteredTrend.length >= 2;
                  return (
                    <div style={s.metricRow}>
                      <MetricCard
                        label={t("dashboard.metrics.recall")}
                        value={Math.round((dashboard?.current.recall ?? 0) * 100)}
                        suffix="%"
                        delta={dashboard?.delta.recall}
                        color="var(--accent)"
                        trend={hasSparkline ? filteredTrend.map((p) => p.recall) : undefined}
                      />
                      <MetricCard
                        label={t("dashboard.metrics.precision")}
                        value={Math.round((dashboard?.current.precision ?? 0) * 100)}
                        suffix="%"
                        delta={dashboard?.delta.precision}
                        color="var(--ok)"
                        trend={hasSparkline ? filteredTrend.map((p) => p.precision) : undefined}
                      />
                      <MetricCard
                        label={t("dashboard.metrics.citationAccuracy")}
                        value={Math.round((dashboard?.current.citation_accuracy ?? 0) * 100)}
                        suffix="%"
                        delta={dashboard?.delta.citation_accuracy}
                        color="var(--warn)"
                        trend={hasSparkline ? filteredTrend.map((p) => p.citation_accuracy) : undefined}
                      />
                    </div>
                  );
                })()}

                {/* Fewer than 2 points has nothing to trend — suppress the whole card rather
                    than render a degenerate/empty chart. */}
                {filteredTrend.length >= 2 && (
                  <div style={s.chartCard}>
                    <SectionLabel
                      icon="TrendingUp"
                      right={
                        <div style={s.legend}>
                          <LegendItem color="var(--accent)" label={t("dashboard.legend.recall")} />
                          <LegendItem color="var(--ok)" label={t("dashboard.legend.precision")} />
                          <LegendItem color="var(--warn)" label={t("dashboard.legend.citation")} />
                        </div>
                      }
                    >
                      {t("detail.metricTrend")}
                    </SectionLabel>
                    <LineChart
                      w={1400}
                      h={240}
                      series={[
                        { name: "recall", color: "var(--accent)", data: filteredTrend.map((p) => p.recall) },
                        { name: "precision", color: "var(--ok)", data: filteredTrend.map((p) => p.precision) },
                        { name: "citation", color: "var(--warn)", data: filteredTrend.map((p) => p.citation_accuracy) },
                      ]}
                      points={filteredTrend.map((p) => ({
                        label: new Date(p.ran_at).toLocaleString(),
                        detail: `${p.agent_version != null ? `v${p.agent_version}` : "—"} · ${formatCost(p.cost_usd)}`,
                      }))}
                    />
                  </div>
                )}

                <SectionLabel
                  icon="History"
                  right={
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {selectedBatchIds.length > 0 && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {t("detail.selectedCount", { count: selectedBatchIds.length })}
                        </span>
                      )}
                      <Button
                        kind="primary"
                        size="sm"
                        icon="GitCompare"
                        disabled={selectedBatchIds.length !== 2}
                        onClick={() => setCompareOpen(true)}
                      >
                        {t("detail.compare")}
                      </Button>
                    </div>
                  }
                >
                  {t("detail.recentRuns")}
                </SectionLabel>

                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th} />
                      <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                      <th style={s.th}>{t("dashboard.table.version")}</th>
                      <th style={s.th}>{t("dashboard.table.recall")}</th>
                      <th style={s.th}>{t("dashboard.table.precision")}</th>
                      <th style={s.th}>{t("dashboard.table.citation")}</th>
                      <th style={s.th}>{t("dashboard.table.pass")}</th>
                      <th style={s.th}>{t("dashboard.table.cost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.map((b: EvalRunBatch) => (
                      <tr key={b.batch_id}>
                        <td style={s.td}>
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.includes(b.batch_id)}
                            onChange={() => toggleSelect(b.batch_id)}
                            aria-label={`Select run ${b.batch_id}`}
                          />
                        </td>
                        <td style={s.td}>{new Date(b.ran_at).toLocaleString()}</td>
                        <td style={s.td}>
                          <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                            {b.agent_version != null ? `v${b.agent_version}` : "—"}
                          </span>
                        </td>
                        <td style={s.td}>
                          <MetricBar value={b.recall} color="var(--accent)" />
                        </td>
                        <td style={s.td}>
                          <MetricBar value={b.precision} color="var(--ok)" />
                        </td>
                        <td style={s.td}>
                          <MetricBar value={b.citation_accuracy} color="var(--warn)" />
                        </td>
                        <td style={{ ...s.td, fontWeight: 600 }}>
                          {b.traces_passed}/{b.traces_total}
                        </td>
                        <td style={s.td}>{formatCost(b.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>

      {compareOpen && oldBatch && newBatch && (
        <CompareRunsModal
          agentId={agentId}
          casesTotal={dashboard?.cases_total ?? 0}
          oldBatch={oldBatch}
          newBatch={newBatch}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </AppShell>
  );
}
