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
  Checkbox,
  FormField,
  TextInput,
  Textarea,
  Button,
} from "@devdigest/ui";
import {
  EvalExpectedOutput,
  type EvalCase,
  type EvalCaseInput,
  type EvalCaseListItem,
} from "@devdigest/shared";
import {
  createEvalCase,
  runEvalCase,
  fetchEvalCases,
  evalQueryKeys,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalCaseModalProps {
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

function validateExpectedOutput(text: string): boolean {
  const { ok, value } = parseJsonSafe(text);
  if (!ok) return false;
  return EvalExpectedOutput.safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalCaseModal({
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
  const [expectedOutputText, setExpectedOutputText] = useState(
    toJsonText(initial.expected_output),
  );
  const [activeInputTab, setActiveInputTab] = useState<InputTab>("diff");
  const [runOnSave, setRunOnSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  // Derived: is the expected_output JSON currently valid?
  const expectedOutputValid = validateExpectedOutput(expectedOutputText);

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

  const lastRunStatusLine = buildLastRunLine(matchedCase, t);

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------
  async function handleSave() {
    if (!expectedOutputValid || saving) return;

    let parsedExpectedOutput: unknown = null;
    const { ok, value } = parseJsonSafe(expectedOutputText);
    if (ok) parsedExpectedOutput = value;

    const input: EvalCaseInput = {
      owner_kind: initial.owner_kind,
      owner_id: initial.owner_id,
      name,
      input_diff: inputDiff,
      input_files: parseJsonSafe(inputFiles).value ?? null,
      input_meta: parseJsonSafe(inputMeta).value ?? null,
      expected_output: parsedExpectedOutput,
      notes: initial.notes,
    };

    setSaving(true);
    try {
      // ALWAYS call createEvalCase — the "review before save" invariant.
      const saved = await createEvalCase(input);

      if (runOnSave) {
        await runEvalCase(saved.id);
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
      await runEvalCase(caseId);
    } finally {
      setRunning(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const saveDisabled = !expectedOutputValid || saving;

  return (
    <Modal
      title={caseId ? t("caseTitle", { name }) : t("newCase")}
      onClose={onClose}
      width={760}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
          }}
        >
          <Checkbox
            checked={runOnSave}
            onChange={setRunOnSave}
            label={t("runOnSave")}
          />
          <div style={{ display: "flex", gap: 8 }}>
            {isEditing && (
              <Button
                kind="secondary"
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
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
        {/* Last-run status (edit mode only) */}
        {isEditing && (
          <div
            style={{
              marginBottom: 12,
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {lastRunStatusLine}
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
            tabs={INPUT_TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
            value={activeInputTab}
            onChange={(k) => setActiveInputTab(k as InputTab)}
            pad="0"
          />
          <div style={{ marginTop: 8 }}>
            {activeInputTab === "diff" && (
              <Textarea
                value={inputDiff}
                onChange={setInputDiff}
                placeholder={t("diffPlaceholder")}
                rows={8}
                mono
              />
            )}
            {activeInputTab === "files" && (
              <Textarea
                value={inputFiles}
                onChange={setInputFiles}
                placeholder='{"filename": "src/foo.ts", "content": "..."}'
                rows={8}
                mono
              />
            )}
            {activeInputTab === "meta" && (
              <Textarea
                value={inputMeta}
                onChange={setInputMeta}
                placeholder={`{"title":"${t("titlePlaceholder")}","body":"${t("bodyPlaceholder")}"}`}
                rows={8}
                mono
              />
            )}
          </div>
        </FormField>

        {/* Expected output */}
        <FormField
          label={t("expectedOutput")}
          required
          right={
            <span
              style={{
                fontSize: 11,
                color: expectedOutputValid
                  ? "var(--ok)"
                  : "var(--crit)",
              }}
            >
              {expectedOutputValid ? t("validJson") : t("invalidJson")}
            </span>
          }
          hint={
            !expectedOutputValid && expectedOutputText.trim()
              ? t("jsonInvalidHint")
              : undefined
          }
        >
          <Textarea
            value={expectedOutputText}
            onChange={setExpectedOutputText}
            rows={6}
            mono
            placeholder={JSON.stringify(
              {
                expectation: "must_find",
                regions: [
                  {
                    file: "src/config.ts",
                    start_line: 10,
                    end_line: 12,
                  },
                ],
              },
              null,
              2,
            )}
          />
        </FormField>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Last-run status builder (separated for clarity)
// ---------------------------------------------------------------------------

function buildLastRunLine(
  c: EvalCaseListItem | undefined,
  t: ReturnType<typeof useTranslations<"eval.caseEditor">>,
): string {
  if (!c || c.latest_run == null) return t("neverRun");

  const lr = c.latest_run;
  const statusLabel = lr.pass ? t("lastRunPassed") : t("lastRunFailed");
  const recall = ((lr.recall ?? 0) * 100).toFixed(0);
  const precision = ((lr.precision ?? 0) * 100).toFixed(0);
  const citation = ((lr.citation_accuracy ?? 0) * 100).toFixed(0);

  return `${statusLabel} · recall ${recall}% · precision ${precision}% · citation ${citation}%`;
}
