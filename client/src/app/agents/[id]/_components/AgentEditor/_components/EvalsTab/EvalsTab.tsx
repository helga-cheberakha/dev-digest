/*
 * EvalsTab — Eval cases list, batch run, history, compare, and version promote.
 * Lesson 06 — TC4.
 */
"use client";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { EvalCase, EvalCaseInput, EvalRunBatch, EvalCompare } from "@devdigest/shared";
import { EvalCaseModal } from "@/components/EvalCaseModal";
import {
  fetchEvalCases,
  fetchEvalBatches,
  fetchEvalCompare,
  runEvalBatch,
  promoteVersion,
  evalQueryKeys,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Local augmentation types — until EvalCaseListItem lands in @devdigest/shared (TC7)
// ---------------------------------------------------------------------------

type LatestRun = {
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  ran_at: string;
} | null;

/** Augmented EvalCase row — `latest_run` is added by the list endpoint (TC7). */
type EvalCaseListItem = EvalCase & { latest_run?: LatestRun };

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

function formatDelta(v: number): React.ReactNode {
  const color =
    v > 0 ? "var(--ok)" : v < 0 ? "var(--crit)" : "var(--text-muted)";
  const sign = v > 0 ? "+" : "";
  return <span style={{ color }}>{sign}{(v * 100).toFixed(1)}%</span>;
}

function toPromptText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalsTab({
  agentId,
  agentVersion,
}: {
  agentId: string;
  agentVersion: number;
}) {
  const t = useTranslations("agents");
  const qc = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: cases, isLoading: casesLoading } = useQuery({
    queryKey: evalQueryKeys.cases(agentId),
    queryFn: () => fetchEvalCases(agentId) as Promise<EvalCaseListItem[]>,
  });

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: evalQueryKeys.batches(agentId),
    queryFn: () => fetchEvalBatches(agentId),
  });

  // ── Local state ──────────────────────────────────────────────────────────────
  const [editingCase, setEditingCase] = useState<EvalCaseListItem | null>(null);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  // batch run
  const [runningBatch, setRunningBatch] = useState(false);
  const [lastBatchResult, setLastBatchResult] = useState<EvalRunBatch | null>(null);

  // compare: up to 2 selected batch_ids
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<EvalCompare | null>(null);
  const [comparing, setComparing] = useState(false);

  // promote
  const [promoting, setPromoting] = useState(false);
  const [promotedVersion, setPromotedVersion] = useState<number | null>(null);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleRunAll = async () => {
    if (runningBatch) return;
    setRunningBatch(true);
    setLastBatchResult(null);
    try {
      const result = await runEvalBatch(agentId);
      setLastBatchResult(result);
      void qc.invalidateQueries({ queryKey: evalQueryKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalQueryKeys.batches(agentId) });
      void qc.invalidateQueries({ queryKey: evalQueryKeys.dashboard(agentId) });
    } finally {
      setRunningBatch(false);
    }
  };

  const toggleBatchSelect = async (batchId: string) => {
    let next: string[];
    if (selectedBatches.includes(batchId)) {
      next = selectedBatches.filter((id) => id !== batchId);
    } else if (selectedBatches.length < 2) {
      next = [...selectedBatches, batchId];
    } else {
      // replace the oldest selection (first in array) with the new one
      next = [selectedBatches[1]!, batchId];
    }
    setSelectedBatches(next);
    setCompareData(null);

    if (next.length === 2) {
      setComparing(true);
      try {
        const data = await fetchEvalCompare(agentId, next[0]!, next[1]!);
        setCompareData(data);
      } finally {
        setComparing(false);
      }
    }
  };

  const handlePromote = async (version: number) => {
    if (promoting) return;
    setPromoting(true);
    setPromotedVersion(null);
    try {
      await promoteVersion(agentId, version);
      setPromotedVersion(version);
      void qc.invalidateQueries({ queryKey: ["agents"] });
    } finally {
      setPromoting(false);
    }
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

  // ── Status icon ───────────────────────────────────────────────────────────────

  function statusIcon(latestRun: LatestRun | undefined) {
    if (latestRun === undefined || latestRun === null) {
      return (
        <span
          role="img"
          aria-label={t("evals.neverRun")}
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <Icon.Info size={14} style={{ color: "var(--text-muted)" }} />
        </span>
      );
    }
    if (latestRun.pass) {
      return (
        <span
          role="img"
          aria-label={t("evals.passed")}
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <Icon.CheckCircle size={14} style={{ color: "var(--ok)" }} />
        </span>
      );
    }
    return (
      <span
        role="img"
        aria-label={t("evals.failed")}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <Icon.XCircle size={14} style={{ color: "var(--crit)" }} />
      </span>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 800, paddingBottom: 40 }}>
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
        <button
          onClick={() => setNewCaseOpen(true)}
          style={{
            marginLeft: "auto",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "5px 12px",
            fontSize: 12,
            cursor: "pointer",
            color: "var(--text-primary)",
          }}
        >
          {t("evals.newCase")}
        </button>
        <button
          onClick={() => void handleRunAll()}
          disabled={runningBatch}
          style={{
            background: "var(--accent)",
            border: "none",
            borderRadius: 5,
            padding: "5px 12px",
            fontSize: 12,
            cursor: runningBatch ? "not-allowed" : "pointer",
            color: "#fff",
            opacity: runningBatch ? 0.7 : 1,
          }}
        >
          {runningBatch ? t("evals.running") : t("evals.runAll")}
        </button>
      </div>

      {/* ── Batch run result metrics ── */}
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
      ) : (cases ?? []).length === 0 ? (
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
          {(cases ?? []).map((c) => {
            const expected = c.expected_output as ExpectedOutput | null;
            const region = expected?.regions?.[0];
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
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 6,
                  marginBottom: 4,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                }}
              >
                {statusIcon(c.latest_run)}
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                  {c.name}
                </span>
                {expected?.expectation && (
                  <Badge color="var(--text-secondary)" mono>
                    {expected.expectation}
                  </Badge>
                )}
                {region && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontFamily: "monospace",
                    }}
                  >
                    {region.file}:{region.start_line}
                  </span>
                )}
                {region?.severity && (
                  <Badge color="var(--warn)" mono>
                    {region.severity}
                  </Badge>
                )}
                {region?.category && (
                  <Badge color="var(--text-secondary)" mono>
                    {region.category}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Run history ── */}
      <div style={{ marginTop: 8, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
          {t("evals.history")}
        </div>
        {batchesLoading ? (
          <Skeleton height={80} />
        ) : (batches ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("evals.noHistory")}
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border)",
                  textAlign: "left",
                  color: "var(--text-muted)",
                }}
              >
                <th style={{ padding: "4px 8px" }}>{t("evals.table.ranAt")}</th>
                <th style={{ padding: "4px 8px" }}>{t("evals.table.version")}</th>
                <th style={{ padding: "4px 8px" }}>{t("evals.table.recall")}</th>
                <th style={{ padding: "4px 8px" }}>{t("evals.table.precision")}</th>
                <th style={{ padding: "4px 8px" }}>{t("evals.table.citation")}</th>
                <th style={{ padding: "4px 8px" }}>{t("evals.table.passedOf")}</th>
                <th style={{ padding: "4px 8px" }}>{t("evals.table.compare")}</th>
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).map((b: EvalRunBatch) => {
                const isSelected = selectedBatches.includes(b.batch_id);
                return (
                  <tr
                    key={b.batch_id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isSelected
                        ? "var(--bg-subtle, var(--bg-surface))"
                        : undefined,
                    }}
                  >
                    <td style={{ padding: "6px 8px" }}>
                      {new Date(b.ran_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {b.agent_version != null ? `v${b.agent_version}` : "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{pct(b.recall)}</td>
                    <td style={{ padding: "6px 8px" }}>{pct(b.precision)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {pct(b.citation_accuracy)}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {b.traces_passed}/{b.traces_total}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <button
                        onClick={() => void toggleBatchSelect(b.batch_id)}
                        style={{
                          background: isSelected
                            ? "var(--accent)"
                            : "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          padding: "2px 8px",
                          fontSize: 11,
                          cursor: "pointer",
                          color: isSelected ? "#fff" : "var(--text-secondary)",
                        }}
                      >
                        {isSelected ? "✓" : t("evals.compare")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Compare panel ── */}
      {selectedBatches.length === 2 && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            background: "var(--bg-surface)",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {t("evals.compareHeading")}
            </span>
            <button
              onClick={() => {
                setSelectedBatches([]);
                setCompareData(null);
              }}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 11,
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
            >
              {t("evals.clearCompare")}
            </button>
          </div>

          {comparing ? (
            <Skeleton height={80} />
          ) : compareData ? (
            <>
              {/* Delta metrics */}
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <div>
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {t("evals.deltaRecall")}
                  </span>
                  <div>{formatDelta(compareData.delta.recall)}</div>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {t("evals.deltaPrecision")}
                  </span>
                  <div>{formatDelta(compareData.delta.precision)}</div>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {t("evals.deltaCitation")}
                  </span>
                  <div>{formatDelta(compareData.delta.citation_accuracy)}</div>
                </div>
              </div>

              {/* Batch A → B summary */}
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 14,
                }}
              >
                {t("evals.promptBefore")}:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  v{compareData.a.agent_version ?? "?"}
                </strong>{" "}
                · {pct(compareData.a.recall)} / {pct(compareData.a.precision)} /{" "}
                {pct(compareData.a.citation_accuracy)}
                {"  →  "}
                {t("evals.promptAfter")}:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  v{compareData.b.agent_version ?? "?"}
                </strong>{" "}
                · {pct(compareData.b.recall)} / {pct(compareData.b.precision)} /{" "}
                {pct(compareData.b.citation_accuracy)}
              </div>

              {/* Prompt diff */}
              {compareData.prompt_diff != null && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 6,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {t("evals.promptDiff")}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginBottom: 4,
                        }}
                      >
                        {t("evals.promptBefore")}
                      </div>
                      <pre
                        style={{
                          fontSize: 11,
                          background: "var(--bg-muted, var(--bg-surface))",
                          borderRadius: 4,
                          padding: 8,
                          overflow: "auto",
                          maxHeight: 200,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {toPromptText(
                          (
                            compareData.prompt_diff as
                              | { before?: unknown; a?: unknown }
                              | null
                          )?.before ??
                            (
                              compareData.prompt_diff as
                                | { before?: unknown; a?: unknown }
                                | null
                            )?.a ??
                            compareData.prompt_diff,
                        )}
                      </pre>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginBottom: 4,
                        }}
                      >
                        {t("evals.promptAfter")}
                      </div>
                      <pre
                        style={{
                          fontSize: 11,
                          background: "var(--bg-muted, var(--bg-surface))",
                          borderRadius: 4,
                          padding: 8,
                          overflow: "auto",
                          maxHeight: 200,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {toPromptText(
                          (
                            compareData.prompt_diff as
                              | { after?: unknown; b?: unknown }
                              | null
                          )?.after ??
                            (
                              compareData.prompt_diff as
                                | { after?: unknown; b?: unknown }
                                | null
                            )?.b,
                        )}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Promote button */}
              {(() => {
                // Promote the batch version that is NOT the current agent version
                const batchA = compareData.a;
                const batchB = compareData.b;
                const nonCurrentBatch =
                  batchA.agent_version !== agentVersion ? batchA : batchB;
                const versionToPromote = nonCurrentBatch.agent_version;
                const alreadyCurrent =
                  versionToPromote === agentVersion || versionToPromote == null;
                return (
                  <button
                    onClick={() => {
                      if (versionToPromote != null)
                        void handlePromote(versionToPromote);
                    }}
                    disabled={alreadyCurrent || promoting}
                    style={{
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: 5,
                      padding: "6px 14px",
                      fontSize: 12,
                      cursor:
                        alreadyCurrent || promoting ? "not-allowed" : "pointer",
                      color: "#fff",
                      opacity: alreadyCurrent || promoting ? 0.5 : 1,
                    }}
                  >
                    {promoting
                      ? t("evals.promoting")
                      : promotedVersion === versionToPromote
                        ? t("evals.promoted")
                        : versionToPromote != null
                          ? t("evals.promote", { version: versionToPromote })
                          : t("evals.promote", { version: "?" })}
                  </button>
                );
              })()}
            </>
          ) : null}
        </div>
      )}

      {/* ── Modals ── */}
      {newCaseOpen && (
        <EvalCaseModal
          initial={blankInitial}
          onSaved={() => {
            setNewCaseOpen(false);
            void qc.invalidateQueries({ queryKey: evalQueryKeys.cases(agentId) });
          }}
          onClose={() => setNewCaseOpen(false)}
        />
      )}
      {editingCase && (
        <EvalCaseModal
          caseId={editingCase.id}
          initial={buildInitialFromCase(editingCase)}
          onSaved={() => {
            setEditingCase(null);
            void qc.invalidateQueries({ queryKey: evalQueryKeys.cases(agentId) });
          }}
          onClose={() => setEditingCase(null)}
        />
      )}
    </div>
  );
}
