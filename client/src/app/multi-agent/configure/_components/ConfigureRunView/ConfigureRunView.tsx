/* ConfigureRunView.tsx — "Configure multi-agent review" page view.
   Lets the user choose which agents to run on a pre-selected PR, shows per-agent
   estimates, and launches the multi-agent run via useLaunchMultiAgentRun(). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { useAgentEstimates, useLaunchMultiAgentRun } from "@/lib/hooks/multiAgent";
import { useAgents } from "@/lib/hooks/agents";
import { usePullDetail } from "@/lib/hooks/core";
import { formatCost } from "@/lib/cost";
import type { AgentEstimate } from "@devdigest/shared";
import type { Agent } from "@devdigest/shared";

// ---- Helpers ----------------------------------------------------------------

/** Format milliseconds as a rounded seconds string e.g. "12s". */
function formatDurationMs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

// ---- Sub-components ---------------------------------------------------------

interface AgentCardProps {
  estimate: AgentEstimate;
  agentName: string;
  checked: boolean;
  onToggle: () => void;
  noEstimateLabel: string;
}

function AgentCard({ estimate, agentName, checked, onToggle, noEstimateLabel }: AgentCardProps) {
  const durationLabel =
    estimate.est_duration_ms !== null
      ? formatDurationMs(estimate.est_duration_ms)
      : noEstimateLabel;

  const costLabel =
    estimate.est_cost_usd !== null ? formatCost(estimate.est_cost_usd) : noEstimateLabel;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8,
        background: checked ? "var(--bg-hover)" : "var(--bg-surface)",
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onClick={onToggle}
      data-testid={`agent-card-${estimate.agent_id}`}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={agentName}
        style={{ marginTop: 3, flexShrink: 0, accentColor: "var(--accent)", cursor: "pointer" }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Agent icon */}
      <Icon.Cpu size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: estimate.last_run_summary ? 6 : 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
            {agentName}
          </span>
          {/* Per-agent estimates */}
          <span
            style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: "auto" }}
            aria-label={`estimate: ${durationLabel} / ${costLabel}`}
          >
            {durationLabel}&nbsp;·&nbsp;{costLabel}
          </span>
        </div>

        {/* Last run summary rendered through SafeMarkdown (untrusted LLM text) */}
        {estimate.last_run_summary && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            <SafeMarkdown content={estimate.last_run_summary} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- ConfigureRunView -------------------------------------------------------

export interface ConfigureRunViewProps {
  initialPrId?: string;
}

export function ConfigureRunView({ initialPrId }: ConfigureRunViewProps) {
  const t = useTranslations("runs");
  const router = useRouter();

  const estimatesQuery = useAgentEstimates();
  const agentsQuery = useAgents();
  const launch = useLaunchMultiAgentRun();
  const prDetailQuery = usePullDetail(initialPrId);

  const estimates = estimatesQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  // Map agent_id → name for display
  const agentNameMap = React.useMemo(
    () => new Map<string, string>(agents.map((a: Agent) => [a.id, a.name])),
    [agents],
  );

  // Initialize all agents as checked once estimates load (one-time default;
  // pattern from INSIGHTS.md 2026-06-25 DiffTab ref flag).
  const [checkedIds, setCheckedIds] = React.useState<Set<string>>(new Set());
  const initialized = React.useRef(false);
  React.useEffect(() => {
    if (estimatesQuery.data && !initialized.current) {
      initialized.current = true;
      setCheckedIds(new Set(estimatesQuery.data.map((e: AgentEstimate) => e.agent_id)));
    }
  }, [estimatesQuery.data]);

  function toggleAgent(agentId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  // ---- Summary calculations -----------------------------------------------
  // time = MAX of checked agents' est_duration_ms (not sum — parallel fan-out)
  // cost = SUM of checked agents' est_cost_usd
  const selectedEstimates = estimates.filter((e: AgentEstimate) => checkedIds.has(e.agent_id));

  const maxDurationMs: number | null = (() => {
    const durations = selectedEstimates
      .map((e: AgentEstimate) => e.est_duration_ms)
      .filter((d): d is number => d !== null);
    return durations.length > 0 ? Math.max(...durations) : null;
  })();

  const sumCostUsd: number | null = (() => {
    const costs = selectedEstimates
      .map((e: AgentEstimate) => e.est_cost_usd)
      .filter((c): c is number => c !== null);
    return costs.length > 0 ? costs.reduce((s, c) => s + c, 0) : null;
  })();

  // ---- Derived state -------------------------------------------------------
  const checkedCount = checkedIds.size;
  const hasPr = !!initialPrId;
  const canRun = hasPr && checkedCount >= 1 && !launch.isPending;

  const isLoading = estimatesQuery.isLoading || agentsQuery.isLoading;
  const isError = estimatesQuery.isError;

  // ---- Handlers ------------------------------------------------------------
  function handleRun() {
    if (!initialPrId || checkedCount === 0) return;
    launch.mutate(
      { prId: initialPrId, agent_ids: Array.from(checkedIds) },
      { onSuccess: (data) => router.push(`/multi-agent/${data.id}`) },
    );
  }

  // ---- Rendering ----------------------------------------------------------
  const crumb = [
    { label: t("page.crumb"), href: "/" },
    { label: t("configure.title") },
  ];

  const noEstimateLabel = t("configure.noEstimate");

  return (
    <AppShell crumb={crumb}>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Header */}
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
            {t("configure.title")}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {t("configure.subtitle")}
          </p>
        </div>

        {/* PR section */}
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            {t("configure.prLabel")}
          </h2>
          {hasPr ? (
            <div
              style={{
                padding: "10px 14px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 14,
                color: "var(--text-primary)",
                background: "var(--bg-surface)",
              }}
            >
              <Icon.GitPullRequest
                size={14}
                style={{ color: "var(--accent)", marginRight: 6, verticalAlign: "middle" }}
              />
              {prDetailQuery.data
                ? t("configure.prValue", {
                    number: prDetailQuery.data.number,
                    title: prDetailQuery.data.title,
                  })
                : initialPrId}
            </div>
          ) : (
            <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>
              {t("configure.noPrSelected")}
            </p>
          )}
        </section>

        {/* Agents section */}
        <section>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            {t("configure.agentsTitle")}
          </h2>

          {!hasPr ? (
            /* Empty state: no PR selected */
            <div
              style={{
                padding: "24px 20px",
                border: "1px dashed var(--border)",
                borderRadius: 8,
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 14,
              }}
            >
              {t("configure.noPrBody")}
            </div>
          ) : isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Skeleton height={72} />
              <Skeleton height={72} />
              <Skeleton height={72} />
            </div>
          ) : isError ? (
            <ErrorState body="Could not load agents." />
          ) : estimates.length === 0 ? (
            <div style={{ padding: "20px", color: "var(--text-muted)", fontSize: 14 }}>
              No agents available.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {estimates.map((estimate: AgentEstimate) => {
                const name = agentNameMap.get(estimate.agent_id) ?? estimate.agent_id;
                return (
                  <AgentCard
                    key={estimate.agent_id}
                    estimate={estimate}
                    agentName={name}
                    checked={checkedIds.has(estimate.agent_id)}
                    onToggle={() => toggleAgent(estimate.agent_id)}
                    noEstimateLabel={noEstimateLabel}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Summary + Run button */}
        <section
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 20,
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          {/* Pre-run summary line */}
          <div style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}>
            <span style={{ fontWeight: 600, color: "var(--text-primary)", marginRight: 6 }}>
              {t("configure.summaryLabel")}
            </span>
            <span data-testid="summary-time">
              {maxDurationMs !== null ? formatDurationMs(maxDurationMs) : noEstimateLabel}
            </span>
            {" · "}
            <span data-testid="summary-cost">
              {formatCost(sumCostUsd)}
            </span>
          </div>

          {/* Run button */}
          <Button
            kind="primary"
            disabled={!canRun}
            onClick={handleRun}
          >
            {launch.isPending
              ? t("configure.running")
              : t("configure.runButton", { count: checkedCount })}
          </Button>
        </section>
      </div>
    </AppShell>
  );
}
