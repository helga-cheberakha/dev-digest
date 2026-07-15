/*
 * ExportWizard — 4-step modal wizard for exporting an agent to CI.
 *
 * Steps:
 *   0 Target     — pick CI platform (gha default + recommended)
 *   1 Preview    — generate files via exportCi(action:'files'), show in <textarea>
 *   2 Configure  — triggers, secrets panel, post_as radio
 *   3 Install    — open PR or download files; success state
 *
 * Preview gap: the export endpoint has no dry-run mode. Calling action:'files'
 * in step 1 DOES persist a CI installation record. Inline edits in the Preview
 * step are stored client-side; they are sent as file_overrides on both the
 * Open PR and Download paths — only actually-changed files are included.
 */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, ExportWizardSteps, Button, Badge, Icon } from "@devdigest/ui";
import type { CiTarget, CiFile, CiExport } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_TARGET = 0;
const STEP_PREVIEW = 1;
const STEP_CONFIGURE = 2;
const STEP_INSTALL = 3;

const CI_TARGETS: readonly CiTarget[] = ["gha", "circle", "jenkins", "cli"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TargetCard({
  id,
  label,
  desc,
  selected,
  recommendedLabel,
  onSelect,
}: {
  id: CiTarget;
  label: string;
  desc: string;
  selected: boolean;
  recommendedLabel?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-target={id}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "14px 16px",
        borderRadius: 10,
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
        background: selected ? "var(--bg-elevated)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        boxShadow: selected ? "0 0 0 3px rgba(99,102,241,0.15)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        {recommendedLabel && (
          <Badge color="var(--ok)">{recommendedLabel}</Badge>
        )}
      </div>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{desc}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ExportWizardProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

export function ExportWizard({ agentId, agentName, onClose }: ExportWizardProps) {
  const t = useTranslations("ci");
  const { activeRepo } = useActiveRepo();
  const previewMutation = useExportCi();
  const installMutation = useExportCi();

  // ── Wizard state ─────────────────────────────────────────────────────────
  const [step, setStep] = useState(STEP_TARGET);
  const [selectedTarget, setSelectedTarget] = useState<CiTarget>("gha");

  // Configure step
  const [triggerOpened, setTriggerOpened] = useState(true);
  const [triggerSynchronize, setTriggerSynchronize] = useState(true);
  const [triggerReopened, setTriggerReopened] = useState(false);
  const [postAs, setPostAs] = useState<"github_review" | "pr_comment" | "none">("github_review");

  // Preview step
  const [previewFiles, setPreviewFiles] = useState<CiFile[]>([]);
  /** Map of path → edited content (tracks user edits on the Preview step) */
  const [editedContents, setEditedContents] = useState<Record<string, string>>({});

  // Install step
  const [installResult, setInstallResult] = useState<CiExport | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────
  const repo = activeRepo?.full_name ?? "";

  const activeTriggers = [
    ...(triggerOpened ? ["opened" as const] : []),
    ...(triggerSynchronize ? ["synchronize" as const] : []),
    ...(triggerReopened ? ["reopened" as const] : []),
  ];

  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.preview"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.install"),
  ];

  const targetDescKey: Record<CiTarget, string> = {
    gha: "exportWizard.targets.ghaDesc",
    circle: "exportWizard.targets.circleDesc",
    jenkins: "exportWizard.targets.jenkinsDesc",
    cli: "exportWizard.targets.cliDesc",
  };
  const targetLabelKey: Record<CiTarget, string> = {
    gha: "exportWizard.targets.gha",
    circle: "exportWizard.targets.circle",
    jenkins: "exportWizard.targets.jenkins",
    cli: "exportWizard.targets.cli",
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleBack() {
    if (step > STEP_TARGET) setStep((s) => s - 1);
  }

  function handleContinue() {
    if (step < STEP_INSTALL) setStep((s) => s + 1);
  }

  function handleGeneratePreview() {
    if (!repo) return;
    previewMutation.mutate(
      {
        agentId,
        input: {
          repo,
          target: selectedTarget,
          action: "files",
          post_as: postAs,
          triggers: activeTriggers,
        },
      },
      {
        onSuccess: (data) => {
          setPreviewFiles(data.files);
          const init: Record<string, string> = {};
          data.files.forEach((f) => {
            init[f.path] = f.contents;
          });
          setEditedContents(init);
        },
      },
    );
  }

  function handleOpenPr() {
    if (!repo) return;

    // Build file_overrides: only include files the user actually changed.
    // Sending unedited files as overrides would mask legitimate server regeneration.
    const fileOverrides = previewFiles
      .filter((f) => editedContents[f.path] !== undefined && editedContents[f.path] !== f.contents)
      .map((f) => ({ path: f.path, contents: editedContents[f.path] as string }));

    installMutation.mutate(
      {
        agentId,
        input: {
          repo,
          target: selectedTarget,
          action: "open_pr",
          post_as: postAs,
          triggers: activeTriggers,
          file_overrides: fileOverrides.length > 0 ? fileOverrides : undefined,
        },
      },
      {
        onSuccess: (data) => setInstallResult(data),
      },
    );
  }

  function handleDownloadFiles() {
    const files = previewFiles.map((f) => ({
      ...f,
      contents: editedContents[f.path] ?? f.contents,
    }));
    files.forEach((f) => {
      const blob = new Blob([f.contents], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.path.split("/").pop() ?? f.path;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ── Step content ─────────────────────────────────────────────────────────

  function renderTarget() {
    return (
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          role="radiogroup"
          aria-label={t("exportWizard.steps.target")}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {CI_TARGETS.map((target) => (
            <TargetCard
              key={target}
              id={target}
              label={t(targetLabelKey[target] as Parameters<typeof t>[0])}
              desc={t(targetDescKey[target] as Parameters<typeof t>[0])}
              selected={selectedTarget === target}
              recommendedLabel={target === "gha" ? t("exportWizard.recommended") : undefined}
              onSelect={() => setSelectedTarget(target)}
            />
          ))}
        </div>
        {!repo && (
          <p style={{ fontSize: 13, color: "var(--crit)", marginTop: 8 }}>
            {t("exportWizard.noRepo")}
          </p>
        )}
      </div>
    );
  }

  function renderPreview() {
    const hasFiles = previewFiles.length > 0;
    return (
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!hasFiles && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t("exportWizard.previewNote")}
            </p>
            <Button
              kind="secondary"
              onClick={handleGeneratePreview}
              disabled={!repo || previewMutation.isPending}
            >
              {previewMutation.isPending
                ? t("exportWizard.previewLoading")
                : t("exportWizard.generatePreview")}
            </Button>
            {previewMutation.isError && (
              <p role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
                {String(previewMutation.error)}
              </p>
            )}
          </div>
        )}
        {hasFiles && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("exportWizard.previewNote")}
            </p>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
              }}
            >
              {t("exportWizard.filesToCreate")}
            </div>
            {previewFiles.map((f) => (
              <div key={f.path} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <Icon.File size={14} />
                  <span>{f.path}</span>
                  {f.editable && (
                    <Badge color="var(--text-muted)">{t("exportWizard.editable")}</Badge>
                  )}
                </div>
                {f.editable ? (
                  <textarea
                    aria-label={f.path}
                    value={editedContents[f.path] ?? f.contents}
                    onChange={(e) =>
                      setEditedContents((prev) => ({ ...prev, [f.path]: e.target.value }))
                    }
                    rows={8}
                    spellCheck={false}
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      resize: "vertical",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  />
                ) : (
                  <pre
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      overflowX: "auto",
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {editedContents[f.path] ?? f.contents}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderConfigure() {
    return (
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Triggers */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            {t("exportWizard.triggerLabel").toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(
              [
                { key: "opened", label: "exportWizard.triggers.opened", value: triggerOpened, set: setTriggerOpened },
                { key: "synchronize", label: "exportWizard.triggers.synchronize", value: triggerSynchronize, set: setTriggerSynchronize },
                { key: "reopened", label: "exportWizard.triggers.reopened", value: triggerReopened, set: setTriggerReopened },
              ] as const
            ).map(({ key, label, value, set }) => (
              <label
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                  aria-label={t(label as Parameters<typeof t>[0])}
                />
                <span>{t(label as Parameters<typeof t>[0])}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Secrets */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            {t("exportWizard.secretsLabel").toUpperCase()}
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {(
              [
                { key: "OPENROUTER_API_KEY", ready: false },
                { key: "GITHUB_TOKEN", ready: true },
              ] as const
            ).map(({ key, ready }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <Icon.Lock size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <code style={{ flex: 1, fontFamily: "monospace" }}>{key}</code>
                <Badge color={ready ? "var(--ok)" : "var(--warn)"}>
                  {ready ? t("exportWizard.secretReady") : t("exportWizard.secretNotSet")}
                </Badge>
              </div>
            ))}
            <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)" }}>
              {t("exportWizard.secretNote", { key: "OPENROUTER_API_KEY" })}
            </div>
          </div>
        </div>

        {/* Post results as */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            {t("exportWizard.postResultsLabel").toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(
              [
                { value: "github_review", labelKey: "exportWizard.postAs.githubReview", recommended: true },
                { value: "pr_comment", labelKey: "exportWizard.postAs.prComment", recommended: false },
                { value: "none", labelKey: "exportWizard.postAs.none", recommended: false },
              ] as const
            ).map(({ value, labelKey, recommended }) => (
              <label
                key={value}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}
              >
                <input
                  type="radio"
                  name="postAs"
                  value={value}
                  checked={postAs === value}
                  onChange={() => setPostAs(value)}
                />
                <span>{t(labelKey as Parameters<typeof t>[0])}</span>
                {recommended && (
                  <Badge color="var(--ok)">{t("exportWizard.recommended")}</Badge>
                )}
              </label>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            {t("exportWizard.blockMergeHint")}
          </p>
        </div>

        {/* Branch protection note */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            fontSize: 13,
          }}
        >
          <strong>{t("exportWizard.blockMergeTitle")}</strong>
          <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 12 }}>
            {t("exportWizard.blockMergeDesc")}
          </p>
        </div>
      </div>
    );
  }

  function renderInstall() {
    if (installResult) {
      return (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.CheckCircle size={20} style={{ color: "var(--ok)" }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>{t("exportWizard.successTitle")}</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {t("exportWizard.installCardBody", {
              repo,
              count: String(installResult.files.length),
            })}
          </p>
          {installResult.pr_url && (
            <a
              href={installResult.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--accent)",
                fontSize: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.ExternalLink size={14} />
              {t("exportWizard.viewPr")}
            </a>
          )}
        </div>
      );
    }

    return (
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Repo display */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("exportWizard.repoLabel")}:
          </span>
          <code style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 600 }}>
            {repo || t("exportWizard.ownerRepo")}
          </code>
        </div>

        {/* Install card */}
        <div
          style={{
            padding: "16px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 6px" }}>
            {t("exportWizard.installCardTitle")}
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
            {t("exportWizard.installCardBody", {
              repo: repo || t("exportWizard.ownerRepo"),
              count: String(previewFiles.length || "—"),
            })}
          </p>
        </div>

        {installMutation.isError && (
          <p role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
            {String(installMutation.error)}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button
            kind="primary"
            onClick={handleOpenPr}
            disabled={!repo || installMutation.isPending}
            icon="GitPullRequest"
          >
            {installMutation.isPending
              ? t("exportWizard.installing")
              : t("exportWizard.openPrAction")}
          </Button>
          {previewFiles.length > 0 && (
            <Button kind="secondary" onClick={handleDownloadFiles} icon="Copy">
              {t("exportWizard.downloadFiles")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const isLastStep = step === STEP_INSTALL;
  const canContinue = step < STEP_INSTALL && !!repo;

  const footer = installResult ? (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <Button kind="primary" onClick={onClose}>
        {t("exportWizard.done")}
      </Button>
    </div>
  ) : (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Button kind="secondary" onClick={step === STEP_TARGET ? onClose : handleBack} icon={step === STEP_TARGET ? undefined : "ChevronLeft"}>
        {step === STEP_TARGET ? t("exportWizard.done") : t("exportWizard.back")}
      </Button>
      {!isLastStep && (
        <Button kind="primary" onClick={handleContinue} disabled={!canContinue}>
          {t("exportWizard.continue")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      width={640}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName })}
      onClose={onClose}
      footer={footer}
    >
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
        <ExportWizardSteps step={step} labels={stepLabels} />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {step === STEP_TARGET && renderTarget()}
        {step === STEP_PREVIEW && renderPreview()}
        {step === STEP_CONFIGURE && renderConfigure()}
        {step === STEP_INSTALL && renderInstall()}
      </div>
    </Modal>
  );
}
