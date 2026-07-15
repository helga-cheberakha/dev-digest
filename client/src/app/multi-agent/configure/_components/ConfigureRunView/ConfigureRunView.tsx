/* ConfigureRunView.tsx — "Configure multi-agent review" page view.
   Lets the user choose which agents to run on a pre-selected PR, shows per-agent
   estimates, and launches the multi-agent run via useLaunchMultiAgentRun(). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState, Icon, Dropdown } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import {
  useAgentEstimates,
  useLaunchMultiAgentRun,
  useLatestMultiAgentRun,
  useRecentMultiAgentRuns,
} from "@/lib/hooks/multiAgent";
import { useAgents } from "@/lib/hooks/agents";
import { usePullDetail, usePulls } from "@/lib/hooks/core";
import { useActiveRepo } from "@/lib/repo-context";
import { formatCost } from "@/lib/cost";
import { formatTimeAgo } from "@/lib/time-ago";
import { agentIcon, agentColor } from "@/lib/agent-visual";
import type { AgentEstimate } from "@devdigest/shared";
import type { Agent } from "@devdigest/shared";
import type { RecentMultiAgentRun } from "@devdigest/shared";

// ---- Helpers ----------------------------------------------------------------

/** Format milliseconds as a rounded seconds string e.g. "12s". */
function formatDurationMs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/** Pre-run summary time = MAX of the given estimates' durations (parallel fan-out, not sum). */
function computeMaxDurationMs(estimates: AgentEstimate[]): number | null {
  const durations = estimates
    .map((e) => e.est_duration_ms)
    .filter((d): d is number => d !== null);
  return durations.length > 0 ? Math.max(...durations) : null;
}

/** Pre-run summary cost = SUM of the given estimates' costs. */
function computeSumCostUsd(estimates: AgentEstimate[]): number | null {
  const costs = estimates
    .map((e) => e.est_cost_usd)
    .filter((c): c is number => c !== null);
  return costs.length > 0 ? costs.reduce((s, c) => s + c, 0) : null;
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

  const iconName = agentIcon(agentName);
  const AgentIconCmp = Icon[iconName];
  const color = agentColor(estimate.agent_id);

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 7,
          background: color.bg,
          flexShrink: 0,
        }}
      >
        <AgentIconCmp size={16} style={{ color: color.ring }} />
      </div>

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

interface RecentRunRowProps {
  run: RecentMultiAgentRun;
  onClick: () => void;
  itemLabel: string;
  metaLabel: string;
}

function RecentRunRow({ run, onClick, itemLabel, metaLabel }: RecentRunRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-surface)",
        color: "var(--text-secondary)",
        fontSize: 13,
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
      }}
    >
      <Icon.History size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={{ color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {itemLabel}
      </span>
      <span style={{ marginLeft: "auto", flexShrink: 0, color: "var(--text-muted)" }}>{metaLabel}</span>
    </button>
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

  // The PR is changeable after mount (not just a one-time query-param seed) —
  // the Configure page is also reachable cold (sidebar nav, no ?prId), where
  // the design's own "Select a pull request…" dropdown is how one gets chosen.
  const [prId, setPrId] = React.useState<string | undefined>(initialPrId);
  const prDetailQuery = usePullDetail(prId);
  const { repoId } = useActiveRepo();
  const pullsQuery = usePulls(repoId);
  const latestRunQuery = useLatestMultiAgentRun(prId);
  const recentRunsQuery = useRecentMultiAgentRuns(repoId);

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

  const maxDurationMs = computeMaxDurationMs(selectedEstimates);
  const sumCostUsd = computeSumCostUsd(selectedEstimates);

  // ---- Derived state -------------------------------------------------------
  const checkedCount = checkedIds.size;
  const hasPr = !!prId;
  const canRun = hasPr && checkedCount >= 1 && !launch.isPending;

  const isLoading = estimatesQuery.isLoading || agentsQuery.isLoading;
  const isError = estimatesQuery.isError;

  // Selectable PRs for the picker — matches the design's `PR_LIST.filter(status !== "stale")`.
  const selectablePulls = (pullsQuery.data ?? []).filter(
    (p) => p.status !== "stale" && p.id != null,
  );

  // ---- Handlers ------------------------------------------------------------
  function handleRun() {
    if (!prId || checkedCount === 0) return;
    launch.mutate(
      { prId, agent_ids: Array.from(checkedIds) },
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

        {/* Recent reviews section — last 5 multi-agent runs for the active repo */}
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            {t("configure.recentRuns.title")}
          </h2>
          {recentRunsQuery.isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton height={38} />
              <Skeleton height={38} />
            </div>
          ) : (recentRunsQuery.data?.runs.length ?? 0) === 0 ? (
            <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: 13 }}>
              {t("configure.recentRuns.empty")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentRunsQuery.data!.runs.map((run) => (
                <RecentRunRow
                  key={run.id}
                  run={run}
                  onClick={() => router.push(`/multi-agent/${run.id}`)}
                  itemLabel={t("configure.recentRuns.item", {
                    number: run.pr_number ?? 0,
                    title: run.pr_title ?? "",
                  })}
                  metaLabel={t("configure.recentRuns.meta", {
                    count: run.agent_count,
                    time: formatTimeAgo(run.ran_at),
                  })}
                />
              ))}
            </div>
          )}
        </section>

        {/* PR section */}
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            {t("configure.prLabel")}
          </h2>
          <Dropdown
            align="left"
            width={380}
            trigger={
              <Button kind="secondary" icon="GitPullRequest" iconRight="ChevronDown">
                {hasPr
                  ? prDetailQuery.data
                    ? t("configure.prValue", {
                        number: prDetailQuery.data.number,
                        title: prDetailQuery.data.title,
                      })
                    : prId
                  : t("configure.selectPrPlaceholder")}
              </Button>
            }
            items={
              selectablePulls.length > 0
                ? selectablePulls.map((p) => ({
                    label: t("configure.prValue", { number: p.number, title: p.title }),
                    icon: "GitPullRequest" as const,
                    onClick: () => setPrId(p.id!),
                  }))
                : [{ label: t("configure.noPullRequests"), muted: true }]
            }
          />
          {hasPr && latestRunQuery.data?.run && (
            <button
              type="button"
              onClick={() => router.push(`/multi-agent/${latestRunQuery.data!.run!.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                fontSize: 13,
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
              }}
            >
              <Icon.History size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span>
                {t("configure.lastRun", {
                  count: latestRunQuery.data.run.agent_count,
                  time: formatTimeAgo(latestRunQuery.data.run.ran_at),
                })}
              </span>
              <span style={{ marginLeft: "auto", color: "var(--accent-text)", fontWeight: 600 }}>
                {t("configure.viewResults")}
              </span>
            </button>
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
