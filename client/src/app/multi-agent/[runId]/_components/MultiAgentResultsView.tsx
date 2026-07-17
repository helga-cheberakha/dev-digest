/* MultiAgentResultsView — "use client" shell for the multi-agent results page.
   Columns mode: N side-by-side agent columns with live SSE status updates.
   Tabs mode: one tab per agent with full FindingRecord detail + 5-action row.
   Shared "Where agents disagree" section below both modes. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  CircularScore,
  Skeleton,
  ErrorState,
  Toggle,
  EmptyState,
  Icon,
  SeverityBadge,
  SectionLabel,
  SEV,
  MonoLink,
} from "@devdigest/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentColumn,
  Conflict,
  ConflictTake,
  FindingRecord,
  EvalCaseInput,
  RunEvent,
} from "@devdigest/shared";
import { EvalInputMeta } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";
import { useMultiAgentRun } from "@/lib/hooks/multiAgent";
import { usePrReviews, useRunEvents, useFindingAction } from "@/lib/hooks/reviews";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import RunTraceDrawer from "@/components/RunTraceDrawer";
import { EvalCaseModal } from "@/components/EvalCaseModal";
import { formatCost } from "@/lib/cost";
import { draftEvalCaseFromFinding, evalQueryKeys, fetchEvalCases } from "@/lib/api";
import { agentIcon, agentColor } from "@/lib/agent-visual";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive column status from persisted value + live SSE events. */
function getLiveStatus(
  col: AgentColumn,
  events: RunEvent[],
): "running" | "done" | "failed" {
  const colEvts = events.filter((e) => e.runId === col.run_id);
  if (colEvts.some((e) => e.kind === "result")) return "done";
  if (colEvts.some((e) => e.kind === "error")) return "failed";
  return col.status;
}

/** A conflict group has "mixed stances" when agents disagree (filter target). */
function isMixedConflict(conflict: Conflict): boolean {
  const flagged = conflict.takes.filter((t) => t.verdict !== "ignored");
  const ignored = conflict.takes.filter((t) => t.verdict === "ignored");
  // Mixed: some flagged + some ignored
  if (flagged.length > 0 && ignored.length > 0) return true;
  // Or: all flagged but with divergent severities
  if (flagged.length >= 2) {
    const severities = new Set(flagged.map((t) => t.verdict));
    return severities.size > 1;
  }
  return false;
}

/** Status display helpers — color token + label. */
function statusMeta(status: "running" | "done" | "failed") {
  if (status === "running") return { color: "var(--accent)", label: "Running" };
  if (status === "done") return { color: "var(--ok)", label: "Done" };
  return { color: "var(--crit)", label: "Failed" };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** One agent column in Columns mode. */
function ColumnCard({
  col,
  liveStatus,
  onViewTrace,
}: {
  col: AgentColumn;
  liveStatus: "running" | "done" | "failed";
  onViewTrace: () => void;
}) {
  const t = useTranslations("runs");
  const { color, label } = statusMeta(liveStatus);
  const iconName = agentIcon(col.agent_name);
  const AgentIconCmp = Icon[iconName];
  const agentClr = agentColor(col.agent_id);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header — icon box + name/time·cost + score circle (or status while
          not done), colored top strip identifies the agent. */}
      <div style={{ padding: 12, borderBottom: "1px solid var(--border)", borderTop: `2px solid ${agentClr.ring}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              background: agentClr.bg,
              flexShrink: 0,
            }}
          >
            <AgentIconCmp size={16} style={{ color: agentClr.ring }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {col.agent_name}
            </div>
            <div className="mono tnum" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
              {col.duration_ms != null && `${(col.duration_ms / 1000).toFixed(1)}s`}
              {col.duration_ms != null && col.cost_usd != null && " · "}
              {col.cost_usd != null && formatCost(col.cost_usd)}
            </div>
          </div>
          {liveStatus === "done" && col.score != null ? (
            <CircularScore score={col.score} size={32} stroke={3.5} />
          ) : (
            // Status: text + role so it's not conveyed by color alone (a11y)
            <span
              role="status"
              aria-label={`${col.agent_name} status: ${label}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color,
                border: `1px solid ${color}`,
                borderRadius: 4,
                padding: "1px 6px",
                flexShrink: 0,
              }}
            >
              {liveStatus === "running" && (
                <Icon.RefreshCw size={10} style={{ animation: "ddspin 1s linear infinite" }} />
              )}
              {label}
            </span>
          )}
        </div>
      </div>

      {/* Findings list */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
        {col.findings.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("column.noFindings")}
          </span>
        ) : (
          col.findings.map((f) => {
            const sev = SEV[f.severity];
            const SevIconCmp = Icon[sev.icon];
            return (
              <div
                key={f.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--bg-surface)",
                  borderLeft: `2px solid ${sev.c}`,
                  minWidth: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <SevIconCmp size={12} style={{ color: sev.c, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, minWidth: 0, overflowWrap: "break-word" }}>
                    <SafeMarkdown content={f.title} />
                  </span>
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4, wordBreak: "break-all" }}
                >
                  {f.file}:{f.start_line}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer — View trace + findings count, on a slightly darker strip */}
      <div
        style={{
          padding: "9px 12px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <MonoLink onClick={onViewTrace}>{t("viewTrace")}</MonoLink>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("column.findingsCount", { count: col.findings.length })}
        </span>
      </div>
    </div>
  );
}

/** Conflicts section — shared between Columns and Tabs mode. */
function ConflictsSection({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("runs");
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);

  const displayed = showOnlyConflicts
    ? conflicts.filter(isMixedConflict)
    : conflicts;

  if (conflicts.length === 0) return null;

  return (
    <div style={{ marginTop: 22 }}>
      <SectionLabel
        icon="Activity"
        right={
          <label
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-secondary)" }}
            title={t("conflicts.onlyConflictsHint")}
          >
            {t("conflicts.onlyConflicts")}
            <Toggle on={showOnlyConflicts} onChange={setShowOnlyConflicts} size={15} />
          </label>
        }
      >
        {t("conflicts.title")}
      </SectionLabel>

      {displayed.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
          {t("conflicts.empty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayed.map((c, i) => (
            <div
              key={`${c.file}:${c.line}:${i}`}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--bg-elevated)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 12, flexShrink: 0 }}>
                  {c.file}:{c.line}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 6, flex: 1, minWidth: 0, overflowWrap: "break-word" }}>
                  <SafeMarkdown content={c.title} />
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${c.takes.length}, 1fr)`,
                  gap: 1,
                  background: "var(--border)",
                }}
              >
                {c.takes.map((take, ti) => (
                  <ConflictTakeCell key={`${take.agent_id}:${ti}`} take={take} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One column in a conflict's grid — one per selected agent, "did not flag" included. */
function ConflictTakeCell({ take }: { take: ConflictTake }) {
  const t = useTranslations("runs");
  const iconName = agentIcon(take.persona);
  const AgentIconCmp = Icon[iconName];
  const agentClr = agentColor(take.agent_id);
  const flagged = take.verdict !== "ignored";
  const dotColor = take.verdict !== "ignored" ? (SEV[take.verdict]?.c ?? "var(--warn)") : "var(--text-muted)";

  return (
    <div style={{ padding: "10px 14px", background: "var(--bg-elevated)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
        <AgentIconCmp size={12} style={{ color: agentClr.ring, flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{take.persona}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: dotColor, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: flagged ? "var(--text-primary)" : "var(--text-muted)",
            textTransform: flagged ? "uppercase" : "none",
            letterSpacing: flagged ? "0.03em" : 0,
          }}
        >
          {flagged ? take.verdict : t("conflicts.didNotFlag")}
        </span>
      </div>
      {/* Don't render empty notes (always '' for ignored, but guard here too) */}
      {take.note && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>
          <SafeMarkdown content={take.note} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TraceDrawerState {
  runId: string;
  agentName: string | null;
  running: boolean;
}

export function MultiAgentResultsView() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId ?? "";
  const router = useRouter();
  const t = useTranslations("runs");

  // ── UI state ──────────────────────────────────────────────────────────────
  const [mode, setMode] = React.useState<"columns" | "tabs">("columns");
  const [activeAgentIdx, setActiveAgentIdx] = React.useState(0);
  const [traceDrawer, setTraceDrawer] = React.useState<TraceDrawerState | null>(null);
  const [modal, setModal] = React.useState<{ initial: EvalCaseInput; caseId?: string } | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: run, isLoading, isError } = useMultiAgentRun(runId);
  const prId = run?.pr_id;
  const { data: reviews = [] } = usePrReviews(prId);

  // Eval cases for "Turn into eval case" dedup (agentId from the active column)
  const activeCol = run?.columns[activeAgentIdx] ?? null;
  const { data: evalCases = [] } = useQuery({
    queryKey: evalQueryKeys.cases(activeCol?.agent_id ?? ""),
    queryFn: () => fetchEvalCases(activeCol!.agent_id),
    enabled: !!activeCol?.agent_id,
  });
  const caseByFindingId = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of evalCases) {
      const meta = EvalInputMeta.safeParse(c.input_meta);
      if (meta.success && !m.has(meta.data.source_finding_id)) {
        m.set(meta.data.source_finding_id, c.id);
      }
    }
    return m;
  }, [evalCases]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const action = useFindingAction();
  const qc = useQueryClient();

  // ── Live SSE status ────────────────────────────────────────────────────────
  const runningRunIds = React.useMemo(
    () => (run?.columns ?? []).filter((c) => c.status === "running").map((c) => c.run_id),
    [run],
  );
  const { events } = useRunEvents(runningRunIds);

  // Fix 3: Refetch as soon as EACH agent finishes, not only once every agent
  // in the fan-out has finished — score/duration/cost/findings stay null until
  // the query is invalidated, and gating that on the OVERALL `running` flag
  // (only false once every SSE connection has closed) meant an agent that
  // finished early never showed its result until the slowest sibling was done
  // too. Track which run ids have already produced a terminal SSE event and
  // invalidate the instant a NEW one appears. Also invalidate `["reviews",
  // prId]` — Tabs mode's finding cards read `findingsForRun` from that query
  // (usePrReviews), not from the multi-agent-run query, so without this a
  // finished agent's findings only ever appeared after a full page reload.
  const seenTerminalRunIdsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    let sawNewTerminal = false;
    for (const e of events) {
      if ((e.kind === "result" || e.kind === "error") && !seenTerminalRunIdsRef.current.has(e.runId)) {
        seenTerminalRunIdsRef.current.add(e.runId);
        sawNewTerminal = true;
      }
    }
    if (sawNewTerminal) {
      void qc.invalidateQueries({ queryKey: ["multi-agent-run", runId] });
      if (prId) void qc.invalidateQueries({ queryKey: ["reviews", prId] });
    }
  }, [events, qc, runId, prId]);
  const draftMutation = useMutation({
    mutationFn: draftEvalCaseFromFinding,
    onSuccess: (data) => setModal({ initial: data }),
  });

  const handleAction = React.useCallback(
    (findingId: string, act: "accept" | "dismiss") => {
      action.mutate({ findingId, action: act, prId });
    },
    [action, prId],
  );

  const handleCreateEvalCase = React.useCallback(
    (findingId: string) => {
      const existingCaseId = caseByFindingId.get(findingId);
      if (existingCaseId) {
        const existing = evalCases.find((c) => c.id === existingCaseId);
        if (existing) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { latest_run, ...initial } = existing;
          setModal({ initial, caseId: existingCaseId });
          return;
        }
      }
      draftMutation.mutate(findingId);
    },
    [caseByFindingId, evalCases, draftMutation],
  );

  // Helper: full FindingRecord[] for a given run_id (from persisted reviews)
  const findingsForRun = React.useCallback(
    (colRunId: string): FindingRecord[] =>
      reviews.find((r) => r.run_id === colRunId)?.findings ?? [],
    [reviews],
  );

  // ── Breadcrumb (shown in every state so the sidebar is always present) ────
  const crumb = [
    { label: t("page.crumb"), href: "/multi-agent/configure" },
    ...(run?.pr_number != null ? [{ label: `#${run.pr_number}` }] : []),
  ];

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={32} />
          <div style={{ display: "flex", gap: 12 }}>
            <Skeleton height={240} />
            <Skeleton height={240} />
            <Skeleton height={240} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (isError || !run) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
          <ErrorState title="Could not load multi-agent run." />
        </div>
      </AppShell>
    );
  }

  // Live per-agent progress.
  const liveStatuses = run.columns.map((c) => getLiveStatus(c, events));
  const doneOrFailedCount = liveStatuses.filter((s) => s !== "running").length;
  const anyRunning = liveStatuses.some((s) => s === "running");

  const totalDurationLabel = anyRunning
    ? t("page.running")
    : `${(run.total_duration_ms / 1000).toFixed(1)}s`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell crumb={crumb}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t("page.title")}</h1>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              disabled={anyRunning}
              onClick={() => router.push(`/multi-agent/configure?prId=${run.pr_id}`)}
            >
              {t("page.runAgain")}
            </Button>
            <div
              style={{
                display: "flex",
                gap: 2,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                padding: 2,
              }}
            >
              {(["columns", "tabs"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  style={{
                    padding: "4px 12px",
                    fontSize: 11.5,
                    fontWeight: 600,
                    borderRadius: 5,
                    border: "none",
                    textTransform: "capitalize",
                    cursor: "pointer",
                    background: mode === k ? "var(--bg-elevated)" : "transparent",
                    color: mode === k ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {t(`page.view.${k}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {run.pr_number != null && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            PR #{run.pr_number}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          {t("page.meta", {
            count: run.agent_count,
            duration: totalDurationLabel,
            cost: formatCost(run.total_cost_usd),
          })}
        </div>
        {/* Live progress banner — makes "agents are running right now" unmissable,
            not just inferable from per-column badges. */}
        {anyRunning && (
          <div
            role="status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              padding: "6px 12px",
              borderRadius: 6,
              background: "var(--accent-bg)",
              color: "var(--accent-text)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Icon.RefreshCw size={14} style={{ animation: "ddspin 1s linear infinite" }} />
            {t("page.progress", { done: doneOrFailedCount, total: run.columns.length })}
          </div>
        )}
      </div>

      {/* Columns mode — up to 5 columns share the row evenly (design:
          `repeat(cols, minmax(220px, 1fr))`); beyond 5, scroll horizontally
          rather than wrapping to a second row. */}
      {mode === "columns" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(run.columns.length, 5)}, minmax(220px, 1fr))`,
            gap: 12,
            overflowX: run.columns.length > 5 ? "auto" : "visible",
          }}
        >
          {run.columns.map((col) => {
            const live = getLiveStatus(col, events);
            return (
              <ColumnCard
                key={col.run_id}
                col={col}
                liveStatus={live}
                onViewTrace={() =>
                  setTraceDrawer({
                    runId: col.run_id,
                    agentName: col.agent_name,
                    running: live === "running",
                  })
                }
              />
            );
          })}
        </div>
      )}

      {/* Tabs mode */}
      {mode === "tabs" && (
        <div>
          {/* Tab bar — underline tabs (design: flat row, colored underline on the
              active tab), NOT boxed buttons. */}
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 20,
              borderBottom: "1px solid var(--border)",
              overflowX: "auto",
            }}
          >
            {run.columns.map((col, idx) => {
              const live = getLiveStatus(col, events);
              const isActive = idx === activeAgentIdx;
              const iconName = agentIcon(col.agent_name);
              const AgentIconCmp = Icon[iconName];
              const color = agentColor(col.agent_id);
              return (
                <button
                  key={col.run_id}
                  type="button"
                  onClick={() => setActiveAgentIdx(idx)}
                  style={{
                    padding: "10px 14px",
                    border: "none",
                    borderBottom: `2px solid ${isActive ? color.ring : "transparent"}`,
                    marginBottom: -1,
                    background: "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    whiteSpace: "nowrap",
                  }}
                >
                  <AgentIconCmp size={15} style={{ color: isActive ? color.ring : "var(--text-muted)", flexShrink: 0 }} />
                  {col.agent_name}
                  {live === "running" && (
                    <Icon.RefreshCw size={12} style={{ animation: "ddspin 1s linear infinite" }} />
                  )}
                  {live === "done" && col.score != null && (
                    <span
                      className="tnum"
                      style={{ fontSize: 11, fontWeight: 700, color: col.score >= 70 ? "var(--ok)" : col.score >= 50 ? "var(--warn)" : "var(--crit)" }}
                    >
                      {col.score}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected agent content */}
          {run.columns[activeAgentIdx] && (() => {
            const col = run.columns[activeAgentIdx]!;
            const live = getLiveStatus(col, events);
            const colFindings = findingsForRun(col.run_id);

            return (
              <div>
                {/* Summary card — design: no icon, big agent-colored name,
                    description below; "View trace" + time/cost stacked on the
                    right. Status badge only surfaces while running/failed
                    (a11y, non-color-only) — a finished run is conveyed by the
                    score circle alone, matching the design's clean done state. */}
                {(() => {
                  const agentClr = agentColor(col.agent_id);
                  return (
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderLeft: `3px solid ${agentClr.ring}`,
                        borderRadius: 10,
                        padding: 16,
                        background: "var(--bg-elevated)",
                        marginBottom: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      {live === "done" && col.score != null && (
                        <CircularScore score={col.score} size={52} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: agentClr.ring }}>
                            {col.agent_name}
                          </span>
                          {live !== "done" && (
                            <span
                              role="status"
                              aria-label={`${col.agent_name} status: ${statusMeta(live).label}`}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: statusMeta(live).color, border: `1px solid ${statusMeta(live).color}`, borderRadius: 4, padding: "1px 6px" }}
                            >
                              {live === "running" && (
                                <Icon.RefreshCw size={10} style={{ animation: "ddspin 1s linear infinite" }} />
                              )}
                              {statusMeta(live).label}
                            </span>
                          )}
                        </div>
                        {col.summary ? (
                          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                            <SafeMarkdown content={col.summary} />
                          </div>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                            {t("tabs.noSummary")}
                          </span>
                        )}
                      </div>
                      <div style={{ marginLeft: "auto", textAlign: "right", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                        <MonoLink
                          onClick={() =>
                            setTraceDrawer({
                              runId: col.run_id,
                              agentName: col.agent_name,
                              running: live === "running",
                            })
                          }
                        >
                          {t("viewTrace")}
                        </MonoLink>
                        <span className="mono tnum" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {col.duration_ms != null && `${(col.duration_ms / 1000).toFixed(1)}s`}
                          {col.duration_ms != null && col.cost_usd != null && " · "}
                          {col.cost_usd != null && formatCost(col.cost_usd)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Finding cards */}
                {colFindings.length === 0 ? (
                  <EmptyState icon="Filter" title={t("column.noFindings")} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {colFindings.map((f) => (
                      <FindingCard
                        key={f.id}
                        f={f}
                        onAction={(act) => {
                          if (act === "accept" || act === "dismiss") handleAction(f.id, act);
                        }}
                        onCreateEvalCase={handleCreateEvalCase}
                        pending={action.isPending}
                        hasEvalCase={caseByFindingId.has(f.id)}
                        showLearnReply
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Conflicts — shared between both modes */}
      <ConflictsSection conflicts={run.conflicts} />

      {/* Run Trace Drawer */}
      {traceDrawer && (
        <RunTraceDrawer
          runId={traceDrawer.runId}
          agentName={traceDrawer.agentName}
          prNumber={run.pr_number ?? null}
          findings={findingsForRun(traceDrawer.runId)}
          running={traceDrawer.running}
          onClose={() => setTraceDrawer(null)}
        />
      )}

      {/* Eval Case Modal */}
      {modal && (
        <EvalCaseModal
          initial={modal.initial}
          caseId={modal.caseId}
          onSaved={() => {
            if (activeCol?.agent_id) {
              void qc.invalidateQueries({
                queryKey: evalQueryKeys.cases(activeCol.agent_id),
              });
            }
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      </div>
    </AppShell>
  );
}
