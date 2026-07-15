/* MultiAgentResultsView — "use client" shell for the multi-agent results page.
   Columns mode: N side-by-side agent columns with live SSE status updates.
   Tabs mode: one tab per agent with full FindingRecord detail + 5-action row.
   Shared "Where agents disagree" section below both modes. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  CategoryTag,
  CircularScore,
  Skeleton,
  ErrorState,
  Toggle,
  EmptyState,
  Icon,
  SeverityBadge,
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
import { useMultiAgentRun } from "@/lib/hooks/multiAgent";
import { usePrReviews, useRunEvents, useFindingAction } from "@/lib/hooks/reviews";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { EvalCaseModal } from "@/components/EvalCaseModal";
import { formatCost } from "@/lib/cost";
import { draftEvalCaseFromFinding, evalQueryKeys, fetchEvalCases } from "@/lib/api";

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

/** Format a finding's line range ("11" when single-line, else "11-15"). */
function lineLabel(f: { start_line: number; end_line: number }): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
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

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        background: "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 220,
        flex: 1,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon.Brain size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {col.agent_name}
        </span>
        {/* Status: text + role so it's not conveyed by color alone (accessibility) */}
        <span
          role="status"
          aria-label={`${col.agent_name} status: ${label}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            border: `1px solid ${color}`,
            borderRadius: 4,
            padding: "1px 6px",
            flexShrink: 0,
          }}
        >
          {label}
        </span>
      </div>

      {/* Model badge */}
      {(col.provider || col.model) && (
        <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {[col.provider, col.model].filter(Boolean).join("/")}
        </span>
      )}

      {/* Score circle */}
      {liveStatus === "done" && col.score != null && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <CircularScore score={col.score} size={52} />
        </div>
      )}

      {/* Time + cost */}
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {col.duration_ms != null && `${(col.duration_ms / 1000).toFixed(1)}s`}
        {col.duration_ms != null && col.cost_usd != null && " · "}
        {col.cost_usd != null && formatCost(col.cost_usd)}
      </div>

      {/* Findings list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {col.findings.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("column.noFindings")}
          </span>
        ) : (
          <>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
              {t("column.findingsCount", { count: col.findings.length })}
            </span>
            {col.findings.map((f) => (
              <div
                key={f.id}
                style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12 }}
              >
                <SeverityBadge severity={f.severity} compact />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SafeMarkdown content={f.title} />
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}
                >
                  {f.file}:{f.start_line}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      <Button kind="secondary" size="sm" icon="FileText" onClick={onViewTrace}>
        {t("viewTrace")}
      </Button>
    </div>
  );
}

/** Expanded finding card for Tabs mode — shows all 5 actions when open. */
function TabsFindingCard({
  f,
  prId,
  agentId,
  onAction,
  onCreateEvalCase,
  actionPending,
}: {
  f: FindingRecord;
  prId: string;
  agentId: string | null;
  /** Only "accept" and "dismiss" go to the network; "learn"/"reply" are local. */
  onAction: (findingId: string, action: "accept" | "dismiss") => void;
  onCreateEvalCase: (findingId: string) => void;
  actionPending: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  // Fix 2: Learn/Reply are "wired-but-inert" — local visual ack only, no network.
  const [learnAck, setLearnAck] = React.useState(false);
  const [replyAck, setReplyAck] = React.useState(false);
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      {/* Collapsed header: always visible */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <SeverityBadge severity={f.severity} compact />
        <CategoryTag category={f.category} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {f.title}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
          {f.file}:{lineLabel(f)}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
          {Math.round(f.confidence * 100)}%
        </span>
        <Icon.ChevronDown
          size={14}
          style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}
        />
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--border)" }}>
          <div style={{ paddingTop: 10, fontSize: 13 }}>
            <SafeMarkdown content={f.rationale} />
          </div>
          {f.suggestion && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 13 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                Suggested fix
              </div>
              <SafeMarkdown content={f.suggestion} />
            </div>
          )}

          {/* 5-action row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={actionPending || accepted}
              active={accepted}
              onClick={() => onAction(f.id, "accept")}
            >
              Accept
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={actionPending || dismissed}
              active={dismissed}
              onClick={() => onAction(f.id, "dismiss")}
            >
              Dismiss
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="Brain"
              active={learnAck}
              onClick={() => setLearnAck(true)}
            >
              Learn
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!accepted && !dismissed}
              onClick={() => onCreateEvalCase(f.id)}
            >
              Turn into eval case
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="MessageSquare"
              active={replyAck}
              onClick={() => setReplyAck(true)}
            >
              Reply to author
            </Button>
          </div>
        </div>
      )}
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
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t("conflicts.title")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
          {t("conflicts.onlyConflicts")}
          <Toggle on={showOnlyConflicts} onChange={setShowOnlyConflicts} size={14} />
        </div>
      </div>

      {displayed.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
          {t("conflicts.empty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {displayed.map((c, i) => (
            <div
              key={`${c.file}:${c.line}:${i}`}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                background: "var(--bg-elevated)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {c.file}:{c.line}
                </span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  <SafeMarkdown content={c.title} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {c.takes.map((take, ti) => (
                  <ConflictTakeRow key={`${take.agent_id}:${ti}`} take={take} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictTakeRow({ take }: { take: ConflictTake }) {
  const t = useTranslations("runs");

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
      <span style={{ fontWeight: 600, minWidth: 100, flexShrink: 0, color: "var(--text-secondary)" }}>
        {take.persona}
      </span>
      {take.verdict === "ignored" ? (
        <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
          {t("conflicts.didNotFlag")}
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SeverityBadge severity={take.verdict} compact />
          {/* Don't render empty notes (always '' for ignored, but guard here too) */}
          {take.note && (
            <div style={{ marginTop: 2 }}>
              <SafeMarkdown content={take.note} />
            </div>
          )}
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
  const { events, running } = useRunEvents(runningRunIds);

  // Fix 3: When the live run finishes, refetch so score/duration/cost/findings
  // update from the DB (they stay null until the query is invalidated).
  // Pattern mirrors RunStatus.tsx's wasRunning ref approach.
  const wasRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (running) wasRunningRef.current = true;
    if (!running && wasRunningRef.current) {
      wasRunningRef.current = false;
      void qc.invalidateQueries({ queryKey: ["multi-agent-run", runId] });
    }
  }, [running, qc, runId]);
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

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={32} />
        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton height={240} />
          <Skeleton height={240} />
          <Skeleton height={240} />
        </div>
      </div>
    );
  }

  if (isError || !run) {
    return <ErrorState title="Could not load multi-agent run." />;
  }

  const totalDurationLabel =
    run.total_duration_ms === 0
      ? t("page.running")
      : `${(run.total_duration_ms / 1000).toFixed(1)}s`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t("page.title")}</h1>
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
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Button
          kind={mode === "columns" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setMode("columns")}
        >
          {t("page.view.columns")}
        </Button>
        <Button
          kind={mode === "tabs" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setMode("tabs")}
        >
          {t("page.view.tabs")}
        </Button>
      </div>

      {/* Columns mode */}
      {mode === "columns" && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
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
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
            {run.columns.map((col, idx) => {
              const live = getLiveStatus(col, events);
              const isActive = idx === activeAgentIdx;
              return (
                <button
                  key={col.run_id}
                  type="button"
                  onClick={() => setActiveAgentIdx(idx)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: isActive ? "var(--accent-bg)" : "var(--bg-elevated)",
                    color: isActive ? "var(--accent-text)" : "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {col.agent_name}
                  {live === "done" && col.score != null && (
                    <span style={{ fontSize: 11, color: col.score >= 75 ? "var(--ok)" : col.score >= 50 ? "var(--warn)" : "var(--crit)" }}>
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
                {/* Summary card */}
                <div
                  style={{
                    border: "1px solid var(--border)",
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
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        role="status"
                        aria-label={`${col.agent_name} status: ${statusMeta(live).label}`}
                        style={{ fontSize: 11, fontWeight: 600, color: statusMeta(live).color, border: `1px solid ${statusMeta(live).color}`, borderRadius: 4, padding: "1px 6px" }}
                      >
                        {statusMeta(live).label}
                      </span>
                      {col.verdict && (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          <SafeMarkdown content={col.verdict} />
                        </div>
                      )}
                    </div>
                    {col.summary ? (
                      <div style={{ fontSize: 13 }}>
                        <SafeMarkdown content={col.summary} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                        {t("tabs.noSummary")}
                      </span>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      {col.duration_ms != null && `${(col.duration_ms / 1000).toFixed(1)}s`}
                      {col.duration_ms != null && col.cost_usd != null && " · "}
                      {col.cost_usd != null && formatCost(col.cost_usd)}
                    </div>
                  </div>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="FileText"
                    onClick={() =>
                      setTraceDrawer({
                        runId: col.run_id,
                        agentName: col.agent_name,
                        running: live === "running",
                      })
                    }
                  >
                    {t("viewTrace")}
                  </Button>
                </div>

                {/* Finding cards */}
                {colFindings.length === 0 ? (
                  <EmptyState icon="Filter" title={t("column.noFindings")} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {colFindings.map((f) => (
                      <TabsFindingCard
                        key={f.id}
                        f={f}
                        prId={prId ?? ""}
                        agentId={col.agent_id}
                        onAction={handleAction}
                        onCreateEvalCase={handleCreateEvalCase}
                        actionPending={action.isPending}
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
  );
}
