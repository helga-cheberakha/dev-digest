"use client";

/**
 * AgentPerformanceView — workspace-level agent performance dashboard.
 *
 * State transitions:
 *   Loading  → skeleton affordance, zero numeric metric text rendered
 *   Error    → error affordance, zero numeric metric text rendered
 *   Empty    → whole-dashboard empty state (summary.runs === 0)
 *              — NOT the individual-section empty variants; one single message
 *   Success  → PeriodPicker + SummaryCards + AgentPerfTable + CostBreakdown
 *
 * AppShell is wrapped in EVERY return branch (INSIGHTS 2026-07-15).
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@devdigest/ui";
import { useAgentPerformance } from "@/lib/hooks/agentPerformance";
import type { PerfWindow } from "@/lib/api";
import { SummaryCards } from "./SummaryCards";
import { AgentPerfTable } from "./AgentPerfTable";
import { CostBreakdown } from "./CostBreakdown";
import { PeriodPicker } from "./PeriodPicker";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  page: { padding: "24px", maxWidth: 1040, margin: "0 auto" } as const,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 16,
    flexWrap: "wrap" as const,
  } as const,
  titleBlock: {} as const,
  h1: { fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: 0 } as const,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" } as const,
  section: { marginBottom: 24 } as const,
  emptyState: {
    padding: "64px 24px",
    textAlign: "center" as const,
  } as const,
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 8px",
  } as const,
  emptyBody: {
    fontSize: 14,
    color: "var(--text-muted)",
    margin: 0,
  } as const,
  error: {
    padding: "16px 20px",
    border: "1px solid var(--crit-bg)",
    borderRadius: 8,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 14,
  } as const,
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();

  // Default period: 30d (AC-10)
  const [perfWindow, setPerfWindow] = useState<PerfWindow>({ period: "30d" });

  const { data, isLoading, isError } = useAgentPerformance(perfWindow);

  const crumb = [{ label: t("title") }];

  // The page header + period picker are rendered in all states (loading,
  // error, empty, success) so the user can always change the period.
  const header = (
    <div style={s.header}>
      <div style={s.titleBlock}>
        <h1 style={s.h1}>{t("title")}</h1>
        <p style={s.subtitle}>{t("subtitle")}</p>
      </div>
      <PeriodPicker value={perfWindow} onChange={setPerfWindow} />
    </div>
  );

  // ------------------------------------------------------------------
  // Loading state — skeleton affordance, no numeric metric text
  // ------------------------------------------------------------------
  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page} data-testid="perf-loading">
          {header}
          <Skeleton height={96} />
          <div style={{ marginTop: 16 }}>
            <Skeleton height={240} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Skeleton height={160} />
          </div>
        </div>
      </AppShell>
    );
  }

  // ------------------------------------------------------------------
  // Error state — error affordance, no numeric metric text
  // ------------------------------------------------------------------
  if (isError || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page} data-testid="perf-error">
          {header}
          <div style={s.error} role="alert">
            {t("loadError")}
          </div>
        </div>
      </AppShell>
    );
  }

  // ------------------------------------------------------------------
  // Empty state — whole-dashboard message (not individual empty sections)
  // ------------------------------------------------------------------
  if (data.summary.runs === 0) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          {header}
          <div data-testid="perf-empty" style={s.emptyState}>
            <h2 style={s.emptyTitle}>{t("empty.title")}</h2>
            <p style={s.emptyBody}>{t("empty.body")}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  // ------------------------------------------------------------------
  // Success state
  // ------------------------------------------------------------------
  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {header}

        <div style={s.section} data-testid="perf-summary-cards">
          <SummaryCards summary={data.summary} />
        </div>

        <div style={s.section} data-testid="perf-agent-table">
          <AgentPerfTable
            rows={data.agents}
            onView={(agentId) => router.push(`/agents/${agentId}?tab=stats`)}
          />
        </div>

        <div data-testid="perf-cost-breakdown">
          <CostBreakdown
            costByAgent={data.cost_by_agent}
            costByModel={data.cost_by_model}
          />
        </div>
      </div>
    </AppShell>
  );
}
