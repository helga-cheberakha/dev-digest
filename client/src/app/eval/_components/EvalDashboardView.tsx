/* EvalDashboardView — workspace-level eval dashboard.
   Fetches the agent list then renders one AgentEvalCard per agent (each card
   fetches its own per-agent dashboard slice in parallel). Below the cards, a
   workspace-wide "recent runs" table sourced from fetchEvalDashboard() with no
   agentId argument (recent_runs is populated server-side for the null-owner case). */
"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { fetchEvalDashboard, runEvalBatch } from "@/lib/api";
import type { Agent } from "@devdigest/shared";
import { AgentEvalCard } from "./AgentEvalCard";

// ---------------------------------------------------------------------------
// Styles (inline — no CSS module needed for this size)
// ---------------------------------------------------------------------------

const s = {
  page: { padding: "24px", maxWidth: 960, margin: "0 auto" } as const,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 16,
  } as const,
  h1: { fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: 0 } as const,
  runAllBtn: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as const,
  runAllBtnDisabled: { opacity: 0.5, cursor: "not-allowed" } as const,
  cardGrid: { display: "grid", gap: 12, marginBottom: 40 } as const,
  loadingGrid: { display: "grid", gap: 12, marginBottom: 40 } as const,
  noAgents: { color: "var(--text-muted)", fontSize: 14, marginBottom: 40 } as const,
  sectionHeading: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 12,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
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

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const [runningAll, setRunningAll] = useState(false);

  // Workspace-level query — used only for recent_runs (per the analytics contract,
  // current/delta/trend are zeroed for the null-owner case; recent_runs IS populated).
  const { data: workspaceDash } = useQuery({
    queryKey: ["eval-dashboard-workspace"],
    queryFn: () => fetchEvalDashboard(),
  });

  async function handleRunAll() {
    if (!agents?.length || runningAll) return;
    setRunningAll(true);
    try {
      await Promise.all(agents.map((a: Agent) => runEvalBatch(a.id)));
    } finally {
      setRunningAll(false);
    }
  }

  const recentRuns = workspaceDash?.recent_runs ?? [];

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
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          <button
            onClick={handleRunAll}
            disabled={runningAll || !agents?.length}
            style={{
              ...s.runAllBtn,
              ...(runningAll || !agents?.length ? s.runAllBtnDisabled : {}),
            }}
          >
            {runningAll ? t("dashboard.running") : t("dashboard.runAll")}
          </button>
        </div>

        {/* Per-agent cards */}
        {agentsLoading ? (
          <div style={s.loadingGrid}>
            <Skeleton height={100} />
            <Skeleton height={100} />
            <Skeleton height={100} />
          </div>
        ) : !agents?.length ? (
          <p style={s.noAgents}>{t("dashboard.noAgents")}</p>
        ) : (
          <div style={s.cardGrid}>
            {agents.map((agent: Agent) => (
              <AgentEvalCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}

        {/* Workspace-wide recent runs table */}
        <section>
          <p style={s.sectionHeading}>{t("dashboard.recentRunsAll")}</p>

          {recentRuns.length === 0 ? (
            <p style={s.emptyMuted}>{t("dashboard.noRecentRuns")}</p>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                  <th style={s.th}>{t("dashboard.table.recall")}</th>
                  <th style={s.th}>{t("dashboard.table.precision")}</th>
                  <th style={s.th}>{t("dashboard.table.citation")}</th>
                  <th style={s.th}>{t("dashboard.table.pass")}</th>
                  <th style={s.th}>{t("dashboard.table.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td style={s.td}>{new Date(run.ran_at).toLocaleString()}</td>
                    <td style={s.td}>
                      {run.recall != null ? `${Math.round(run.recall * 100)}%` : "—"}
                    </td>
                    <td style={s.td}>
                      {run.precision != null ? `${Math.round(run.precision * 100)}%` : "—"}
                    </td>
                    <td style={s.td}>
                      {run.citation_accuracy != null
                        ? `${Math.round(run.citation_accuracy * 100)}%`
                        : "—"}
                    </td>
                    <td style={s.td}>
                      {run.pass === true
                        ? t("dashboard.pass")
                        : run.pass === false
                          ? t("dashboard.fail")
                          : "—"}
                    </td>
                    <td style={s.td}>
                      {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "—"}
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
