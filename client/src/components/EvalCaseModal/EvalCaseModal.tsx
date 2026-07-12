"use client";
/**
 * EvalCaseModal — shared modal for creating and editing eval cases.
 *
 * Call sites provide `initial: EvalCaseInput` (blank, finding-derived draft,
 * or existing case data) and optionally `caseId` (when editing a persisted
 * case).  The modal is AGNOSTIC to where `initial` came from — it always calls
 * `createEvalCase` on Save regardless of origin. This is the "review before
 * save" guarantee: the draft endpoint never persists; only this modal's Save
 * action does.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Modal,
  Tabs,
  FormField,
  TextInput,
  SelectInput,
  Textarea,
  Button,
  Toggle,
  Icon,
} from "@devdigest/ui";
import {
  EvalExpectedOutput,
  type EvalCase,
  type EvalCaseInput,
  type EvalCaseListItem,
  type EvalRun,
  type Severity,
  type FindingCategory,
} from "@devdigest/shared";
import {
  createEvalCase,
  runEvalCase,
  fetchEvalCases,
  evalQueryKeys,
} from "@/lib/api";
import { formatCost } from "@/lib/cost";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalCaseModalProps {
  /** Owning agent's display name — rendered in the modal subtitle when known
   *  (call sites without an agent in scope, e.g. the finding-derived draft
   *  flow, omit it and get a generic subtitle instead). */
  agentName?: string;
  /** The initial field values — may be blank, finding-derived, or from an
   *  existing case row. The modal does not care about the source. */
  initial: EvalCaseInput;
  /** When provided, the modal is in "edit existing" mode: shows a Run case
   *  button and a last-run status line. */
  caseId?: string;
  /** Called after `createEvalCase` succeeds (and after `runEvalCase` if
   *  "Run on save" is toggled). */
  onSaved: (c: EvalCase) => void;
  /** Called by the Cancel button — MUST NOT trigger any persist call. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Region row types
// ---------------------------------------------------------------------------

type RegionRow = {
  file: string;
  start_line: number;
  end_line: number;
  severity?: Severity;
  category?: FindingCategory;
};

// ---------------------------------------------------------------------------
// Diff line parsing (read-only colorized preview for the Diff tab)
// ---------------------------------------------------------------------------

type DiffLineKind = "file-header" | "hunk" | "add" | "del" | "ctx";
interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

function parseDiffLines(diff: string): DiffLine[] {
  return diff.split("\n").map((raw): DiffLine => {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      return { kind: "file-header", text: raw };
    }
    if (raw.startsWith("@@")) return { kind: "hunk", text: raw };
    if (raw.startsWith("+")) return { kind: "add", text: raw };
    if (raw.startsWith("-")) return { kind: "del", text: raw };
    return { kind: "ctx", text: raw };
  });
}

const DIFF_LINE_STYLE: Record<DiffLineKind, React.CSSProperties> = {
  "file-header": { color: "var(--text-muted)" },
  hunk: { color: "var(--accent)" },
  add: { background: "var(--ok-bg)", color: "var(--ok)" },
  del: { background: "var(--crit-bg)", color: "var(--crit)" },
  ctx: { color: "var(--text-secondary)" },
};

function DiffPreview({ diff }: { diff: string }) {
  const lines = parseDiffLines(diff);
  return (
    <div
      className="mono"
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: 7,
        background: "var(--bg-elevated)",
        overflow: "auto",
        maxHeight: 260,
        fontSize: 12.5,
        lineHeight: 1.6,
      }}
    >
      {lines.map((ln, i) => (
        <div
          key={i}
          style={{
            ...DIFF_LINE_STYLE[ln.kind],
            padding: "0 12px",
            whiteSpace: "pre",
          }}
        >
          {ln.text || " "}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INPUT_TABS = [
  { key: "diff", label: "Diff" },
  { key: "files", label: "Files" },
  { key: "meta", label: "PR meta" },
] as const;
type InputTab = (typeof INPUT_TABS)[number]["key"];

function toJsonText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function parseJsonSafe(text: string): { ok: boolean; value?: unknown } {
  if (!text.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Hydrate expectation + regions from `initial.expected_output`.
 *  On parse success, map stored regions to RegionRow.
 *  On failure / blank / null, default to must_find + one empty row. */
function hydrateExpectedOutput(raw: unknown): {
  expectation: "must_find" | "must_not_flag";
  regions: RegionRow[];
} {
  const result = EvalExpectedOutput.safeParse(raw);
  if (result.success) {
    return {
      expectation: result.data.expectation,
      regions: result.data.regions.map((r) => ({
        file: r.file,
        start_line: r.start_line,
        end_line: r.end_line,
        ...(r.severity ? { severity: r.severity } : {}),
        ...(r.category ? { category: r.category } : {}),
      })),
    };
  }
  return {
    expectation: "must_find",
    regions: [{ file: "", start_line: 1, end_line: 1 }],
  };
}

/** A region row is invalid when file is blank or start_line > end_line. */
function isRowInvalid(row: RegionRow): boolean {
  return row.file.trim() === "" || row.start_line > row.end_line;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalCaseModal({
  agentName,
  initial,
  caseId,
  onSaved,
  onClose,
}: EvalCaseModalProps) {
  const t = useTranslations("eval.caseEditor");

  // Form state
  const [name, setName] = useState(initial.name ?? "");
  const [inputDiff, setInputDiff] = useState(initial.input_diff ?? "");
  const [inputFiles, setInputFiles] = useState(toJsonText(initial.input_files));
  const [inputMeta, setInputMeta] = useState(toJsonText(initial.input_meta));
  const [activeInputTab, setActiveInputTab] = useState<InputTab>("diff");
  const [diffEditing, setDiffEditing] = useState(!inputDiff);
  const [runOnSave, setRunOnSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [freshRun, setFreshRun] = useState<EvalRun | null>(null);

  // Expected-output structured state (hydrated from initial on mount)
  const [expectation, setExpectation] = useState<"must_find" | "must_not_flag">(
    () => hydrateExpectedOutput(initial.expected_output).expectation,
  );
  const [regions, setRegions] = useState<RegionRow[]>(
    () => hydrateExpectedOutput(initial.expected_output).regions,
  );

  // ---------------------------------------------------------------------------
  // Option arrays (built here so t() is in scope)
  // ---------------------------------------------------------------------------

  const expectationOptions = [
    { value: "must_find", label: t("expectation.mustFind") },
    { value: "must_not_flag", label: t("expectation.mustNotFlag") },
  ];

  const severityOptions: { value: string; label: string }[] = [
    { value: "", label: t("severityNone") },
    { value: "CRITICAL", label: "CRITICAL" },
    { value: "WARNING", label: "WARNING" },
    { value: "SUGGESTION", label: "SUGGESTION" },
  ];

  const categoryOptions: { value: string; label: string }[] = [
    { value: "", label: t("categoryNone") },
    { value: "bug", label: "bug" },
    { value: "security", label: "security" },
    { value: "perf", label: "perf" },
    { value: "style", label: "style" },
    { value: "test", label: "test" },
  ];

  // ---------------------------------------------------------------------------
  // Region handlers
  // ---------------------------------------------------------------------------

  function updateRegion(i: number, patch: Partial<RegionRow>) {
    setRegions((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function removeRegion(i: number) {
    setRegions((prev) => prev.filter((_, j) => j !== i));
  }

  function addRegion() {
    setRegions((prev) => [...prev, { file: "", start_line: 1, end_line: 1 }]);
  }

  // ---------------------------------------------------------------------------
  // Edit-mode: fetch cases to show last-run status
  // ---------------------------------------------------------------------------
  const isEditing = !!caseId;
  const { data: cases } = useQuery({
    queryKey: evalQueryKeys.cases(initial.owner_id),
    queryFn: () => fetchEvalCases(initial.owner_id),
    enabled: isEditing,
  });

  const matchedCase: EvalCaseListItem | undefined = isEditing
    ? cases?.find((c) => c.id === caseId)
    : undefined;

  const statusLine = buildStatusLine({ matchedCase, freshRun, regionsLength: regions.length, t });

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------
  const saveDisabled =
    saving || !name.trim() || regions.length === 0 || regions.some(isRowInvalid);

  async function handleSave() {
    if (saveDisabled) return;

    const expected_output = {
      expectation,
      regions: regions.map((r) => ({
        file: r.file,
        start_line: r.start_line,
        end_line: r.end_line,
        ...(r.severity ? { severity: r.severity } : {}),
        ...(r.category ? { category: r.category } : {}),
      })),
    };

    const input: EvalCaseInput = {
      owner_kind: initial.owner_kind,
      owner_id: initial.owner_id,
      name,
      input_diff: inputDiff,
      input_files: parseJsonSafe(inputFiles).value ?? null,
      input_meta: parseJsonSafe(inputMeta).value ?? null,
      expected_output,
      notes: initial.notes,
    };

    setSaving(true);
    try {
      // ALWAYS call createEvalCase — the "review before save" invariant.
      const saved = await createEvalCase(input);

      if (runOnSave) {
        const { result } = await runEvalCase(saved.id);
        setFreshRun(result);
      }

      onSaved(saved);
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Run-case handler (edit mode only)
  // ---------------------------------------------------------------------------
  async function handleRunCase() {
    if (!caseId || running) return;
    setRunning(true);
    try {
      const { result } = await runEvalCase(caseId);
      setFreshRun(result);
    } finally {
      setRunning(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal
      title={caseId ? t("caseTitle", { name }) : t("newCase")}
      subtitle={agentName ? t("subtitle", { agentName }) : t("subtitleGeneric")}
      onClose={onClose}
      width={860}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <Toggle on={runOnSave} onChange={setRunOnSave} size={14} />
            {t("runOnSave")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {isEditing && (
              <Button
                kind="secondary"
                icon="Play"
                onClick={handleRunCase}
                disabled={running}
                loading={running}
              >
                {running ? t("running") : t("runCase")}
              </Button>
            )}
            <Button kind="secondary" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Check"
              onClick={handleSave}
              disabled={saveDisabled}
              loading={saving}
            >
              {saving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", gap: 24 }}>
        {/* ── Left column: name + input ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Last-run status (edit mode only) */}
          {isEditing && statusLine && (
            <div
              style={{
                marginBottom: 12,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {statusLine}
            </div>
          )}

          {/* Name */}
          <FormField label={t("nameLabel")} required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("namePlaceholder")}
            />
          </FormField>

          {/* Input tabs */}
          <FormField label={t("inputLabel")}>
            <Tabs
              tabs={INPUT_TABS.map((tab) => ({
                key: tab.key,
                label: tab.key === "files" ? t("tabs.files") : tab.key === "diff" ? t("tabs.diff") : t("tabs.prMeta"),
              }))}
              value={activeInputTab}
              onChange={(k) => setActiveInputTab(k as InputTab)}
              pad="0"
            />
            <div style={{ marginTop: 8 }}>
              {activeInputTab === "diff" && (
                <div>
                  {inputDiff && (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={() => setDiffEditing((v) => !v)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 11,
                          color: "var(--text-muted)",
                          padding: 0,
                        }}
                      >
                        <Icon.Edit size={11} />
                        {diffEditing ? t("previewDiff") : t("editDiff")}
                      </button>
                    </div>
                  )}
                  {diffEditing || !inputDiff ? (
                    <Textarea
                      value={inputDiff}
                      onChange={setInputDiff}
                      placeholder={t("diffPlaceholder")}
                      rows={10}
                      mono
                    />
                  ) : (
                    <DiffPreview diff={inputDiff} />
                  )}
                </div>
              )}
              {activeInputTab === "files" && (
                <Textarea
                  value={inputFiles}
                  onChange={setInputFiles}
                  placeholder='{"filename": "src/foo.ts", "content": "..."}'
                  rows={10}
                  mono
                />
              )}
              {activeInputTab === "meta" && (
                <Textarea
                  value={inputMeta}
                  onChange={setInputMeta}
                  placeholder={`{"title":"${t("titlePlaceholder")}","body":"${t("bodyPlaceholder")}"}`}
                  rows={10}
                  mono
                />
              )}
            </div>
          </FormField>
        </div>

        {/* ── Right column: expectation + regions ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Expectation selector */}
          <FormField label={t("expectationLabel")} required>
            <SelectInput
              value={expectation}
              onChange={(v) => setExpectation(v as "must_find" | "must_not_flag")}
              options={expectationOptions}
              mono={false}
            />
          </FormField>

          {/* Region rows */}
          <FormField label={t("regionsLabel")} required>
            <div>
              {regions.map((row, i) => {
                const invalid = isRowInvalid(row);
                return (
                  <div
                    key={i}
                    style={{
                      border: `1px solid ${invalid ? "var(--crit)" : "var(--border-strong)"}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 8,
                      background: invalid ? "var(--crit-bg)" : "var(--bg-card)",
                    }}
                  >
                    {/* Row 1: file input + remove button */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <TextInput
                          value={row.file}
                          onChange={(v) => updateRegion(i, { file: v })}
                          placeholder={t("regionFilePlaceholder")}
                          aria-label={t("regionFile")}
                          mono
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={t("removeRegion")}
                        onClick={() => removeRegion(i)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 28,
                          height: 28,
                          flexShrink: 0,
                          background: "none",
                          border: "1px solid var(--border-strong)",
                          borderRadius: 6,
                          cursor: "pointer",
                          color: "var(--text-muted)",
                          padding: 0,
                        }}
                      >
                        <Icon.X size={13} />
                      </button>
                    </div>

                    {/* Row 2: start/end lines + severity + category */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr 1fr",
                        gap: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                          {t("regionStartLine")}
                        </div>
                        <TextInput
                          value={String(row.start_line)}
                          onChange={(v) => {
                            const n = parseInt(v, 10);
                            updateRegion(i, { start_line: isNaN(n) ? row.start_line : n });
                          }}
                          type="number"
                          aria-label={t("regionStartLine")}
                          mono
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                          {t("regionEndLine")}
                        </div>
                        <TextInput
                          value={String(row.end_line)}
                          onChange={(v) => {
                            const n = parseInt(v, 10);
                            updateRegion(i, { end_line: isNaN(n) ? row.end_line : n });
                          }}
                          type="number"
                          aria-label={t("regionEndLine")}
                          mono
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                          {t("regionSeverity")}
                        </div>
                        <SelectInput
                          value={row.severity ?? ""}
                          onChange={(v) =>
                            updateRegion(i, {
                              severity: v === "" ? undefined : (v as Severity),
                            })
                          }
                          options={severityOptions}
                          mono={false}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                          {t("regionCategory")}
                        </div>
                        <SelectInput
                          value={row.category ?? ""}
                          onChange={(v) =>
                            updateRegion(i, {
                              category: v === "" ? undefined : (v as FindingCategory),
                            })
                          }
                          options={categoryOptions}
                          mono={false}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add region button */}
              <Button
                kind="secondary"
                size="sm"
                icon="Plus"
                onClick={addRegion}
              >
                {t("addRegion")}
              </Button>
            </div>
          </FormField>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Status line builder — prefers a freshly-run result (duration + cost
// available) over the persisted list-view summary (recall/precision only).
// ---------------------------------------------------------------------------

function buildStatusLine({
  matchedCase,
  freshRun,
  regionsLength,
  t,
}: {
  matchedCase: EvalCaseListItem | undefined;
  freshRun: EvalRun | null;
  regionsLength: number;
  t: ReturnType<typeof useTranslations<"eval.caseEditor">>;
}): React.ReactNode {
  if (freshRun) {
    const trace = freshRun.per_trace?.[0] as
      | { pass?: boolean | null; actual?: unknown }
      | undefined;
    const pass = trace?.pass ?? freshRun.traces_passed === freshRun.traces_total;
    const expected = regionsLength;
    const actual = trace?.actual as { findings?: unknown[] } | undefined;
    const got = actual?.findings?.length ?? Math.round(freshRun.recall * expected);
    const statusLabel = pass ? t("lastRunPassed") : t("lastRunFailed");
    return `${statusLabel} · ${t("resultSummaryRich", {
      expected,
      got,
      duration: (freshRun.duration_ms / 1000).toFixed(1),
      cost: formatCost(freshRun.cost_usd),
    })}`;
  }

  if (!matchedCase || matchedCase.latest_run == null) return t("neverRun");

  const lr = matchedCase.latest_run;
  const statusLabel = lr.pass ? t("lastRunPassed") : t("lastRunFailed");
  const recall = ((lr.recall ?? 0) * 100).toFixed(0);
  const precision = ((lr.precision ?? 0) * 100).toFixed(0);
  const citation = ((lr.citation_accuracy ?? 0) * 100).toFixed(0);

  return `${statusLabel} · ${t("resultSummary", { recall, precision, citation })}`;
}
