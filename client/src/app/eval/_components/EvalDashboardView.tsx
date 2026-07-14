/* EvalDashboardView — workspace-level eval dashboard.
   Fetches the agent list then renders one AgentEvalCard per agent (each card
   fetches its own per-agent dashboard slice in parallel). Below the cards, a
   workspace-wide "recent runs" table is built client-side from every agent's
   batch history (fetchEvalBatches) — the null-owner dashboard variant has no
   agent identity to attach to a row, so batches (already agent-scoped) are the
   source of truth here instead. */
"use client";

import React, { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Skeleton, Button, SectionLabel } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { fetchEvalBatches, runEvalBatch, evalQueryKeys } from "@/lib/api";
import type { Agent, EvalRunBatch } from "@devdigest/shared";
import { AgentEvalCard } from "./AgentEvalCard";
import { MetricBar } from "./MetricBar";

// ---------------------------------------------------------------------------
// Styles (inline — no CSS module needed for this size)
// ---------------------------------------------------------------------------

const s = {
  page: { padding: "24px", maxWidth: 1040, margin: "0 auto" } as const,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 28,
    gap: 16,
  } as const,
  h1: { fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: 0 } as const,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" } as const,
  cardGrid: { display: "grid", gap: 12, marginBottom: 36 } as const,
  loadingGrid: { display: "grid", gap: 12, marginBottom: 36 } as const,
  noAgents: { color: "var(--text-muted)", fontSize: 14, marginBottom: 36 } as const,
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
  emptyMuted: { color: "var(--text-muted)", fontSize: 13, padding: "12px 0" } as const,
};

// ---------------------------------------------------------------------------
// EvalDashboardView
// ---------------------------------------------------------------------------

interface RecentBatchRow extends EvalRunBatch {
  agentId: string;
  agentName: string;
}

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const qc = useQueryClient();
  const [runningAll, setRunningAll] = useState(false);
  const [runAllError, setRunAllError] = useState<string | null>(null);

  // One batch-history query per agent — powers both the "last run" line on
  // each AgentEvalCard and the workspace-wide recent-runs table below.
  const batchQueries = useQueries({
    queries: (agents ?? []).map((agent: Agent) => ({
      queryKey: evalQueryKeys.batches(agent.id),
      queryFn: () => fetchEvalBatches(agent.id),
      enabled: !!agents?.length,
    })),
  });

  const batchesLoading = !!agents?.length && batchQueries.some((q) => q.isLoading);

  const recentRuns: RecentBatchRow[] = (agents ?? [])
    .flatMap((agent: Agent, i: number) =>
      (batchQueries[i]?.data ?? []).map((b) => ({ ...b, agentId: agent.id, agentName: agent.name })),
    )
    .sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime())
    .slice(0, 8);

  async function handleRunAll() {
    if (!agents?.length || runningAll) return;
    setRunningAll(true);
    setRunAllError(null);
    try {
      await Promise.all(agents.map((a: Agent) => runEvalBatch(a.id)));
      void qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["eval-batches"] });
    } catch (err) {
      setRunAllError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRunningAll(false);
    }
  }

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard") },
      ]}
    >
      <div style={s.page}>
        {/* Page header */}
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            loading={runningAll}
            disabled={runningAll || !agents?.length}
            onClick={() => void handleRunAll()}
          >
            {runningAll ? t("dashboard.running") : t("dashboard.runAll")}
          </Button>
        </div>

        {/* Run-all error */}
        {runAllError && (
          <div
            role="alert"
            style={{
              color: "var(--crit)",
              fontSize: 13,
              marginBottom: 12,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--crit)",
              background: "var(--crit-bg, transparent)",
            }}
          >
            {runAllError}
          </div>
        )}

        {/* Per-agent cards */}
        <SectionLabel icon="Cpu">{t("dashboard.sectionAgents")}</SectionLabel>
        {agentsLoading ? (
          <div style={s.loadingGrid}>
            <Skeleton height={84} />
            <Skeleton height={84} />
            <Skeleton height={84} />
          </div>
        ) : !agents?.length ? (
          <p style={s.noAgents}>{t("dashboard.noAgents")}</p>
        ) : (
          <div style={s.cardGrid}>
            {agents.map((agent: Agent, i: number) => (
              <AgentEvalCard key={agent.id} agent={agent} batches={batchQueries[i]?.data} />
            ))}
          </div>
        )}

        {/* Workspace-wide recent runs table */}
        <section>
          <SectionLabel icon="History">{t("dashboard.recentRunsAll")}</SectionLabel>

          {batchesLoading ? (
            <Skeleton height={140} />
          ) : recentRuns.length === 0 ? (
            <p style={s.emptyMuted}>{t("dashboard.noRecentRuns")}</p>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.table.agent")}</th>
                  <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                  <th style={s.th}>{t("dashboard.table.version")}</th>
                  <th style={s.th}>{t("dashboard.table.recall")}</th>
                  <th style={s.th}>{t("dashboard.table.precision")}</th>
                  <th style={s.th}>{t("dashboard.table.citation")}</th>
                  <th style={s.th}>{t("dashboard.table.pass")}</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.batch_id}>
                    <td style={s.td}>{run.agentName}</td>
                    <td style={s.td}>{new Date(run.ran_at).toLocaleString()}</td>
                    <td style={s.td}>
                      <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                        {run.agent_version != null ? `v${run.agent_version}` : "—"}
                      </span>
                    </td>
                    <td style={s.td}>
                      <MetricBar value={run.recall} color="var(--accent)" />
                    </td>
                    <td style={s.td}>
                      <MetricBar value={run.precision} color="var(--ok)" />
                    </td>
                    <td style={s.td}>
                      <MetricBar value={run.citation_accuracy} color="var(--warn)" />
                    </td>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      {run.traces_passed}/{run.traces_total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
