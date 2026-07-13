/*
 * EvalsTab — Eval metrics strip + eval case management (run/edit/delete).
 * Run history, batch compare, and version promote moved to the full
 * dashboard at /eval/[agentId] (see client/INSIGHTS.md).
 * Lesson 06 — TC4.
 */
"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, IconBtn, Skeleton, SectionLabel } from "@devdigest/ui";
import type { EvalCaseInput, EvalCaseListItem } from "@devdigest/shared";
import { EvalCaseModal } from "@/components/EvalCaseModal";
import {
  fetchEvalCases,
  fetchEvalDashboard,
  runEvalBatch,
  runEvalCase,
  deleteEvalCase,
  evalQueryKeys,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Local helper types
// ---------------------------------------------------------------------------

/** Narrowed expected_output shape from EvalExpectedOutput in eval-ci.ts. */
type ExpectedOutput = {
  expectation?: "must_find" | "must_not_flag";
  regions?: Array<{
    file: string;
    start_line: number;
    end_line: number;
    severity?: string;
    category?: string;
  }>;
};

// ---------------------------------------------------------------------------
// Sub-helpers
// ---------------------------------------------------------------------------

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Metric tile (RECALL / PRECISION / CITATION ACCURACY / TRACES PASSED)
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  color,
  deltaPts,
}: {
  label: string;
  value: string;
  color: string;
  deltaPts?: number;
}) {
  const flat = deltaPts === 0;
  const up = (deltaPts ?? 0) > 0;
  const dc = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const DeltaIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
        <span className="tnum" style={{ fontSize: 26, fontWeight: 700, color }}>
          {value}
        </span>
        {deltaPts != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 12,
              fontWeight: 600,
              color: dc,
            }}
          >
            <DeltaIcon size={11} />
            <span className="tnum">{Math.abs(deltaPts)}pt</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalsTab({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const t = useTranslations("agents");
  const qc = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: cases, isLoading: casesLoading } = useQuery({
    queryKey: evalQueryKeys.cases(agentId),
    queryFn: () => fetchEvalCases(agentId),
  });

  const { data: dashboard } = useQuery({
    queryKey: evalQueryKeys.dashboard(agentId),
    queryFn: () => fetchEvalDashboard(agentId),
  });

  // ── Local state ──────────────────────────────────────────────────────────────
  const [editingCase, setEditingCase] = useState<EvalCaseListItem | null>(null);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  const [runningBatch, setRunningBatch] = useState(false);
  const [lastBatchResult, setLastBatchResult] = useState<{
    recall: number;
    precision: number;
    citation_accuracy: number;
  } | null>(null);

  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function invalidateAll() {
    void qc.invalidateQueries({ queryKey: evalQueryKeys.cases(agentId) });
    void qc.invalidateQueries({ queryKey: evalQueryKeys.dashboard(agentId) });
  }

  const handleRunAll = async () => {
    if (runningBatch) return;
    setRunningBatch(true);
    setLastBatchResult(null);
    try {
      const result = await runEvalBatch(agentId);
      setLastBatchResult(result);
      invalidateAll();
    } finally {
      setRunningBatch(false);
    }
  };

  const handleRunCase = async (caseId: string) => {
    if (runningCaseId) return;
    setRunningCaseId(caseId);
    try {
      await runEvalCase(caseId);
      invalidateAll();
    } finally {
      setRunningCaseId(null);
    }
  };

  const handleDeleteCase = async (c: EvalCaseListItem) => {
    if (!window.confirm(t("evals.deleteConfirm", { name: c.name }))) return;
    await deleteEvalCase(c.id);
    invalidateAll();
  };

  // ── Derived values ────────────────────────────────────────────────────────────

  function buildInitialFromCase(c: EvalCaseListItem): EvalCaseInput {
    return {
      owner_kind: c.owner_kind,
      owner_id: c.owner_id,
      name: c.name,
      input_diff: c.input_diff,
      input_files: c.input_files,
      input_meta: c.input_meta,
      expected_output: c.expected_output,
      notes: c.notes,
    };
  }

  const blankInitial: EvalCaseInput = {
    owner_kind: "agent",
    owner_id: agentId,
    name: "",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: null,
    notes: null,
  };

  const casesList = cases ?? [];
  const passedCount = casesList.filter((c) => c.latest_run?.pass === true).length;

  // ── Status icon ───────────────────────────────────────────────────────────────

  function statusIcon(latestRun: EvalCaseListItem["latest_run"] | undefined) {
    if (latestRun === undefined || latestRun === null) {
      return (
        <span
          role="img"
          aria-label={t("evals.neverRun")}
          style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
        >
          <Icon.Dot size={18} style={{ color: "var(--text-muted)" }} />
        </span>
      );
    }
    if (latestRun.pass) {
      return (
        <span
          role="img"
          aria-label={t("evals.passed")}
          style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
        >
          <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
        </span>
      );
    }
    return (
      <span
        role="img"
        aria-label={t("evals.failed")}
        style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
      >
        <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
      </span>
    );
  }

  // ── Row subtitle: "expected N finding(s), got M" derived from recall ──────────

  function rowSubtitle(c: EvalCaseListItem): string {
    if (!c.latest_run) return t("evals.neverRun");
    const expected = c.expected_output as ExpectedOutput | null;
    const n = expected?.regions?.length ?? 0;
    const got = Math.round((c.latest_run.recall ?? 0) * n);
    return t("evals.expectedGot", { expected: n, got });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1040, paddingBottom: 40 }}>
      {/* ── Eval metrics strip ── */}
      <SectionLabel
        icon="Gauge"
        right={
          <Link
            href={`/eval/${agentId}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            {t("evals.viewFullDashboard")}
            <Icon.ArrowRight size={12} />
          </Link>
        }
      >
        {t("evals.metricsTitle")}
      </SectionLabel>

      {/* Delta is only meaningful once a prior batch exists to compare against —
          a lone first batch defaults delta to 0 server-side, which would render
          as a misleading "flat, unchanged" badge rather than "no baseline yet". */}
      {(() => {
        const hasBaseline = (dashboard?.trend.length ?? 0) >= 2;
        return (
          <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
            <MetricTile
              label={t("evals.tiles.recall")}
              value={pct(dashboard?.current.recall)}
              color="var(--accent)"
              deltaPts={hasBaseline ? Math.round(dashboard!.delta.recall * 100) : undefined}
            />
            <MetricTile
              label={t("evals.tiles.precision")}
              value={pct(dashboard?.current.precision)}
              color="var(--ok)"
              deltaPts={hasBaseline ? Math.round(dashboard!.delta.precision * 100) : undefined}
            />
            <MetricTile
              label={t("evals.tiles.citationAccuracy")}
              value={pct(dashboard?.current.citation_accuracy)}
              color="var(--warn)"
              deltaPts={hasBaseline ? Math.round(dashboard!.delta.citation_accuracy * 100) : undefined}
            />
            <MetricTile
              label={t("evals.tiles.tracesPassed")}
              value={
                dashboard
                  ? `${dashboard.current.traces_passed}/${dashboard.current.traces_total}`
                  : "—"
              }
              color="var(--text-primary)"
            />
          </div>
        );
      })()}

      {/* ── Case list header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {t("evals.casesHeading")}
        </span>
        {casesList.length > 0 && (
          <Badge color="var(--ok)" bg="var(--ok-bg)">
            {t("evals.passingCount", { passed: passedCount, total: casesList.length })}
          </Badge>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button kind="secondary" icon="Play" onClick={() => void handleRunAll()} loading={runningBatch}>
            {runningBatch ? t("evals.running") : t("evals.runAll")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setNewCaseOpen(true)}>
            {t("evals.newCase")}
          </Button>
        </div>
      </div>

      {/* ── Batch run result ── */}
      {lastBatchResult && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            fontSize: 13,
          }}
        >
          {t("evals.batchResult", {
            recall: pct(lastBatchResult.recall).replace("%", ""),
            precision: pct(lastBatchResult.precision).replace("%", ""),
            citation: pct(lastBatchResult.citation_accuracy).replace("%", ""),
          })}
        </div>
      )}

      {/* ── Cases ── */}
      {casesLoading ? (
        <Skeleton height={120} />
      ) : casesList.length === 0 ? (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            marginBottom: 24,
          }}
        >
          {t("evals.emptyCases")}
        </p>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {casesList.map((c) => {
            const expected = c.expected_output as ExpectedOutput | null;
            const region = expected?.regions?.[0];
            const isEmptyExpectation =
              expected?.expectation === "must_not_flag" && (expected.regions?.length ?? 0) === 0;
            const isRunningThis = runningCaseId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setEditingCase(c)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setEditingCase(c);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 6,
                  marginBottom: 4,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                }}
              >
                {statusIcon(c.latest_run)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {rowSubtitle(c)}
                  </div>
                </div>
                {isEmptyExpectation ? (
                  <Badge color="var(--text-secondary)" mono>
                    {t("evals.emptyExpectation")}
                  </Badge>
                ) : region?.severity || region?.category ? (
                  <Badge color="var(--text-secondary)" mono>
                    {[region.severity, region.category].filter(Boolean).join(" · ")}
                  </Badge>
                ) : null}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: "flex", gap: 2, flexShrink: 0 }}
                >
                  <IconBtn
                    icon="Play"
                    label={t("evals.runCaseLabel")}
                    onClick={() => void handleRunCase(c.id)}
                  />
                  <IconBtn
                    icon="Edit"
                    label={t("evals.editCaseLabel")}
                    onClick={() => setEditingCase(c)}
                  />
                  <IconBtn
                    icon="Trash"
                    label={t("evals.deleteCaseLabel")}
                    danger
                    onClick={() => void handleDeleteCase(c)}
                  />
                </div>
                {isRunningThis && (
                  <Icon.RefreshCw size={13} style={{ animation: "ddspin 1s linear infinite", color: "var(--text-muted)" }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ── */}
      {newCaseOpen && (
        <EvalCaseModal
          agentName={agentName}
          initial={blankInitial}
          onSaved={() => {
            setNewCaseOpen(false);
            invalidateAll();
          }}
          onClose={() => setNewCaseOpen(false)}
        />
      )}
      {editingCase && (
        <EvalCaseModal
          agentName={agentName}
          caseId={editingCase.id}
          initial={buildInitialFromCase(editingCase)}
          onSaved={() => {
            setEditingCase(null);
            invalidateAll();
          }}
          onClose={() => setEditingCase(null)}
        />
      )}
    </div>
  );
}
