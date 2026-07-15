/* CiRunsView — workspace-wide CI run history with filter chips.
   Renders only succeeded / no_findings / failed status badges; no running-state UI.
   Filtering is client-side; the server returns the full list. */
"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Skeleton, Button, Badge, EmptyState, Icon } from "@devdigest/ui";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { formatCost } from "@/lib/cost";
import type { CiRun } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only these three statuses get styled badges (no running-state UI per spec). */
const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  succeeded: { color: "var(--ok)", bg: "var(--ok-bg, transparent)" },
  no_findings: { color: "var(--text-muted)", bg: "var(--bg-elevated)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg, transparent)" },
};

const SOURCE_LABELS: Record<string, string> = {
  gha: "GitHub Actions",
  circle: "CircleCI",
  jenkins: "Jenkins",
  cli: "CLI",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  page: { padding: "24px", maxWidth: 1200, margin: "0 auto" } as const,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 16,
  } as const,
  h1: { fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: 0 } as const,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" } as const,
  headerRight: { display: "flex", alignItems: "center", gap: 12 } as const,
  autoRefresh: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } as const,
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    background: "var(--ok)",
    display: "inline-block",
  } as const,
  filters: {
    display: "flex",
    gap: 8,
    marginBottom: 16,
    flexWrap: "wrap" as const,
  } as const,
  select: {
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 12,
    cursor: "pointer",
  } as const,
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
  muted: { color: "var(--text-muted)", fontSize: 13, padding: "16px 0" } as const,
  traceLink: {
    color: "var(--accent)",
    display: "inline-flex",
    alignItems: "center",
  } as const,
};

// ---------------------------------------------------------------------------
// CiRunsView
// ---------------------------------------------------------------------------

export function CiRunsView() {
  const t = useTranslations("ci");
  const router = useRouter();
  const { data, isLoading } = useCiRuns();
  const { mutate: refresh, isPending: refreshing } = useRefreshCiRuns();

  const [timeRange, setTimeRange] = useState<"7d" | "all">("7d");
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  // Unique agents / sources derived from current data (for dynamic filter options).
  const agents = useMemo(() => {
    const seen = new Set<string>();
    (data ?? []).forEach((r) => {
      if (r.agent) seen.add(r.agent);
    });
    return [...seen].sort();
  }, [data]);

  const sources = useMemo(() => {
    const seen = new Set<string>();
    (data ?? []).forEach((r) => {
      if (r.source) seen.add(r.source);
    });
    return [...seen].sort();
  }, [data]);

  // Client-side filtering — all four chips narrow the same list.
  const filteredRuns: CiRun[] = useMemo(() => {
    let runs = data ?? [];
    if (timeRange === "7d") {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      runs = runs.filter((r) => r.ran_at != null && r.ran_at >= cutoff);
    }
    if (agentFilter) runs = runs.filter((r) => r.agent === agentFilter);
    if (statusFilter) runs = runs.filter((r) => r.status === statusFilter);
    if (sourceFilter) runs = runs.filter((r) => r.source === sourceFilter);
    return runs;
  }, [data, timeRange, agentFilter, statusFilter, sourceFilter]);

  const isEmpty = (data?.length ?? 0) === 0;
  const isFilterEmpty = !isEmpty && filteredRuns.length === 0;

  const crumb = [{ label: t("page.crumb") }];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={40} />
          <div style={{ marginTop: 16 }}>
            <Skeleton height={200} />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <div style={s.headerRight}>
            {/* Decorative auto-refresh indicator — not a working polling loop */}
            <span style={s.autoRefresh}>
              <span style={s.dot} />
              {t("runs.autoRefresh")}
            </span>
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={refreshing}
              onClick={() => refresh()}
            >
              {refreshing ? t("runs.refreshing") : t("runs.refresh")}
            </Button>
          </div>
        </div>

        {/* Filter chips */}
        <div style={s.filters}>
          <select
            aria-label="time range filter"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as "7d" | "all")}
            style={s.select}
          >
            <option value="7d">{t("runs.filters.last7Days")}</option>
            <option value="all">{t("runs.filters.allTime")}</option>
          </select>
          <select
            aria-label="agent filter"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            style={s.select}
          >
            <option value="">{t("runs.filters.allAgents")}</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            aria-label="status filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={s.select}
          >
            <option value="">{t("runs.filters.allStatuses")}</option>
            <option value="succeeded">{t("runs.status.succeeded")}</option>
            <option value="no_findings">{t("runs.status.noFindings")}</option>
            <option value="failed">{t("runs.status.failed")}</option>
          </select>
          <select
            aria-label="source filter"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={s.select}
          >
            <option value="">{t("runs.filters.allSources")}</option>
            {sources.map((src) => (
              <option key={src} value={src}>
                {SOURCE_LABELS[src] ?? src}
              </option>
            ))}
          </select>
        </div>

        {/* Content area */}
        {isEmpty ? (
          <EmptyState
            icon="Workflow"
            title={t("runs.emptyTitle")}
            body={t("runs.emptyBody")}
            cta={t("runs.emptyCta")}
            onCta={() => router.push("/agents")}
          />
        ) : isFilterEmpty ? (
          <p style={s.muted} aria-live="polite">
            {t("runs.noMatch")}
          </p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{t("runs.table.timestamp")}</th>
                <th style={s.th}>{t("runs.table.pullRequest")}</th>
                <th style={s.th}>{t("runs.table.agent")}</th>
                <th style={s.th}>{t("runs.table.source")}</th>
                <th style={s.th}>{t("runs.table.duration")}</th>
                <th style={s.th}>{t("runs.table.findings")}</th>
                <th style={s.th}>{t("runs.table.cost")}</th>
                <th style={s.th}>{t("runs.table.status")}</th>
                {/* Trace link — no header label per spec */}
                <th style={s.th} />
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const statusStyle = STATUS_STYLE[run.status ?? ""];
                const statusLabel =
                  run.status === "succeeded"
                    ? t("runs.status.succeeded")
                    : run.status === "no_findings"
                      ? t("runs.status.noFindings")
                      : run.status === "failed"
                        ? t("runs.status.failed")
                        : null;
                return (
                  <tr key={run.id}>
                    <td style={s.td}>{formatTimestamp(run.ran_at)}</td>
                    <td style={s.td}>
                      {run.pr_number != null ? `#${run.pr_number}` : "—"}
                    </td>
                    <td style={s.td}>{run.agent ?? "—"}</td>
                    <td style={s.td}>
                      {SOURCE_LABELS[run.source ?? ""] ?? run.source ?? "—"}
                    </td>
                    <td style={s.td}>{formatDuration(run.duration_s)}</td>
                    <td style={s.td}>
                      {(run.findings_count ?? 0) > 0 ? run.findings_count : "—"}
                    </td>
                    <td style={s.td}>{formatCost(run.cost_usd)}</td>
                    <td style={s.td}>
                      {statusLabel && statusStyle ? (
                        <Badge color={statusStyle.color} bg={statusStyle.bg}>
                          {statusLabel}
                        </Badge>
                      ) : (
                        run.status ?? "—"
                      )}
                    </td>
                    <td style={s.td}>
                      {run.github_url ? (
                        <a
                          href={run.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("runs.view")}
                          style={s.traceLink}
                        >
                          <Icon.ExternalLink size={14} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
