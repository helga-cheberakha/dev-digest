/*
 * EvalsTab — Eval metrics strip + eval case management (run/edit/delete).
 * No "View full dashboard" link — there is no /eval/[skillId] page in v1.
 * Lesson 06 — TC3 (benchmark + batch-history + compare wiring in TC8).
 */
"use client";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, IconBtn, Skeleton, SectionLabel } from "@devdigest/ui";
import type { EvalCaseInput, EvalCaseListItem, EvalRunBatch, EvalBenchmark } from "@devdigest/shared";
import { EvalCaseModal } from "@/components/EvalCaseModal";
import { SkillCompareRunsModal } from "./SkillCompareRunsModal";
import {
  fetchSkillEvalCases,
  fetchSkillEvalDashboard,
  fetchSkillEvalBatches,
  runSkillEvalBatch,
  runSkillEvalBenchmark,
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
// Lift tile — shows a metric delta as its primary value
// ---------------------------------------------------------------------------

function LiftTile({ label, delta }: { label: string; delta: number }) {
  const pts = Math.round(delta * 100);
  const flat = pts === 0;
  const up = pts > 0;
  const color = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <DeltaIcon size={13} style={{ color }} />
        <span className="tnum" style={{ fontSize: 22, fontWeight: 700, color }}>
          {Math.abs(pts)}pt
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalsTab({
  skillId,
  skillName,
}: {
  skillId: string;
  skillName: string;
}) {
  const t = useTranslations("skills");
  const qc = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: cases, isLoading: casesLoading } = useQuery({
    queryKey: evalQueryKeys.skillCases(skillId),
    queryFn: () => fetchSkillEvalCases(skillId),
  });

  const { data: dashboard } = useQuery({
    queryKey: evalQueryKeys.skillDashboard(skillId),
    queryFn: () => fetchSkillEvalDashboard(skillId),
  });

  const { data: batches } = useQuery({
    queryKey: evalQueryKeys.skillBatches(skillId),
    queryFn: () => fetchSkillEvalBatches(skillId),
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

  const [runningBenchmark, setRunningBenchmark] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<EvalBenchmark | null>(null);

  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);

  // Batch-history selection — at most 2 IDs. When non-null, compare modal is open.
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [compareModalBatches, setCompareModalBatches] = useState<[EvalRunBatch, EvalRunBatch] | null>(null);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function invalidateAll() {
    void qc.invalidateQueries({ queryKey: evalQueryKeys.skillCases(skillId) });
    void qc.invalidateQueries({ queryKey: evalQueryKeys.skillDashboard(skillId) });
    void qc.invalidateQueries({ queryKey: evalQueryKeys.skillBatches(skillId) });
  }

  const handleRunAll = async () => {
    if (runningBatch) return;
    setRunningBatch(true);
    setLastBatchResult(null);
    try {
      const result = await runSkillEvalBatch(skillId);
      setLastBatchResult(result);
      invalidateAll();
    } finally {
      setRunningBatch(false);
    }
  };

  const handleBenchmark = async () => {
    if (runningBenchmark) return;
    setRunningBenchmark(true);
    setBenchmarkResult(null);
    try {
      const result = await runSkillEvalBenchmark(skillId);
      setBenchmarkResult(result);
      invalidateAll();
    } finally {
      setRunningBenchmark(false);
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

  const toggleBatchSelection = (batchId: string) => {
    setSelectedBatchIds((prev) => {
      if (prev.includes(batchId)) return prev.filter((id) => id !== batchId);
      if (prev.length >= 2) return prev;
      return [...prev, batchId];
    });
  };

  const handleCompare = () => {
    if (selectedBatchIds.length !== 2 || !batches) return;
    const batchA = batches.find((b) => b.batch_id === selectedBatchIds[0]);
    const batchB = batches.find((b) => b.batch_id === selectedBatchIds[1]);
    if (!batchA || !batchB) return;
    // Older ran_at → oldBatch, newer → newBatch
    const sorted = [batchA, batchB].sort(
      (x, y) => new Date(x.ran_at).getTime() - new Date(y.ran_at).getTime(),
    );
    setCompareModalBatches(sorted as [EvalRunBatch, EvalRunBatch]);
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
    owner_kind: "skill",
    owner_id: skillId,
    name: "",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: null,
    notes: null,
  };

  const casesList = cases ?? [];
  const passedCount = casesList.filter((c) => c.latest_run?.pass === true).length;
  const batchList = batches ?? [];

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
      <SectionLabel icon="Gauge">
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
          <Button
            kind="secondary"
            icon="BarChart"
            onClick={() => void handleBenchmark()}
            loading={runningBenchmark}
          >
            {runningBenchmark ? t("evals.benchmarking") : t("evals.benchmark")}
          </Button>
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

      {/* ── Benchmark result panel ── */}
      {benchmarkResult && (
        <div
          style={{
            marginBottom: 24,
            padding: 20,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-surface)",
          }}
        >
          <SectionLabel icon="BarChart">{t("evals.benchmarkPanel.heading")}</SectionLabel>

          {/* Candidate (with skill) */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            {t("evals.benchmarkPanel.candidateLabel")}
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <MetricTile
              label={t("evals.benchmarkPanel.tiles.recall")}
              value={pct(benchmarkResult.candidate.recall)}
              color="var(--accent)"
            />
            <MetricTile
              label={t("evals.benchmarkPanel.tiles.precision")}
              value={pct(benchmarkResult.candidate.precision)}
              color="var(--ok)"
            />
            <MetricTile
              label={t("evals.benchmarkPanel.tiles.citationAccuracy")}
              value={pct(benchmarkResult.candidate.citation_accuracy)}
              color="var(--warn)"
            />
          </div>

          {/* Baseline (no skill) */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            {t("evals.benchmarkPanel.baselineLabel")}
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <MetricTile
              label={t("evals.benchmarkPanel.tiles.recall")}
              value={pct(benchmarkResult.baseline.recall)}
              color="var(--accent)"
            />
            <MetricTile
              label={t("evals.benchmarkPanel.tiles.precision")}
              value={pct(benchmarkResult.baseline.precision)}
              color="var(--ok)"
            />
            <MetricTile
              label={t("evals.benchmarkPanel.tiles.citationAccuracy")}
              value={pct(benchmarkResult.baseline.citation_accuracy)}
              color="var(--warn)"
            />
          </div>

          {/* Lift deltas — taken directly from server's delta field */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <LiftTile
              label={t("evals.benchmarkPanel.lift.recall")}
              delta={benchmarkResult.delta.recall}
            />
            <LiftTile
              label={t("evals.benchmarkPanel.lift.precision")}
              delta={benchmarkResult.delta.precision}
            />
            <LiftTile
              label={t("evals.benchmarkPanel.lift.citation")}
              delta={benchmarkResult.delta.citation_accuracy}
            />
          </div>

          {/* Per-case comparison table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-muted)", fontWeight: 600 }}>
                  Case
                </th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-muted)", fontWeight: 600 }}>
                  {t("evals.benchmarkPanel.table.candidatePass")}
                </th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-muted)", fontWeight: 600 }}>
                  {t("evals.benchmarkPanel.table.baselinePass")}
                </th>
              </tr>
            </thead>
            <tbody>
              {benchmarkResult.per_case.map((row) => (
                <tr key={row.case_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}>{row.case_name}</td>
                  <td style={{ textAlign: "center", padding: "6px 8px" }}>
                    {row.candidate_pass === null ? "—" : row.candidate_pass ? "✓" : "✗"}
                  </td>
                  <td style={{ textAlign: "center", padding: "6px 8px" }}>
                    {row.baseline_pass === null ? "—" : row.baseline_pass ? "✓" : "✗"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* ── Batch history ── */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {t("evals.batchHistory")}
          </span>
          <div style={{ marginLeft: "auto" }}>
            <Button
              kind="secondary"
              icon="GitCompare"
              onClick={handleCompare}
              disabled={selectedBatchIds.length !== 2}
            >
              {t("evals.compareSelected")}
            </Button>
          </div>
        </div>
        {batchList.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>—</p>
        ) : (
          batchList.map((batch) => {
            const selected = selectedBatchIds.includes(batch.batch_id);
            const versionLabel = batch.agent_version != null ? `v${batch.agent_version}` : "—";
            return (
              <div
                key={batch.batch_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 6,
                  marginBottom: 4,
                  border: "1px solid var(--border)",
                  background: selected ? "var(--bg-elevated)" : "var(--bg-surface)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleBatchSelection(batch.batch_id)}
                  aria-label={`Select batch ${versionLabel}`}
                />
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40 }}>
                  {versionLabel}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
                  {new Date(batch.ran_at).toLocaleDateString()}
                </span>
                <span className="tnum" style={{ fontSize: 12 }}>
                  {pct(batch.recall)} / {pct(batch.precision)} / {pct(batch.citation_accuracy)}
                </span>
                <span
                  className="tnum"
                  style={{ fontSize: 12, color: "var(--text-muted)" }}
                >
                  {batch.traces_passed}/{batch.traces_total}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* ── Modals ── */}
      {newCaseOpen && (
        <EvalCaseModal
          agentName={skillName}
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
          agentName={skillName}
          caseId={editingCase.id}
          initial={buildInitialFromCase(editingCase)}
          onSaved={() => {
            setEditingCase(null);
            invalidateAll();
          }}
          onClose={() => setEditingCase(null)}
        />
      )}
      {compareModalBatches && (
        <SkillCompareRunsModal
          skillId={skillId}
          casesTotal={cases?.length ?? 0}
          oldBatch={compareModalBatches[0]}
          newBatch={compareModalBatches[1]}
          onClose={() => setCompareModalBatches(null)}
        />
      )}
    </div>
  );
}
