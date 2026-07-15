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
import { Modal, ExportWizardSteps, Button } from "@devdigest/ui";
import type { CiTarget, CiFile, CiExport } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import { TargetStep } from "./_components/TargetStep/TargetStep";
import { PreviewStep } from "./_components/PreviewStep/PreviewStep";
import { ConfigureStep } from "./_components/ConfigureStep/ConfigureStep";
import { InstallStep } from "./_components/InstallStep/InstallStep";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_TARGET = 0;
const STEP_PREVIEW = 1;
const STEP_CONFIGURE = 2;
const STEP_INSTALL = 3;

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

  // ── Render ───────────────────────────────────────────────────────────────

  const isLastStep = step === STEP_INSTALL;
  const canContinue = step < STEP_INSTALL && !!repo;

  const footer = installResult ? (
    <div style={s.footerSuccess}>
      <Button kind="primary" onClick={onClose}>
        {t("exportWizard.done")}
      </Button>
    </div>
  ) : (
    <div style={s.footerNormal}>
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
      <div style={s.stepperWrap}>
        <ExportWizardSteps step={step} labels={stepLabels} />
      </div>
      <div style={s.stepBody}>
        {step === STEP_TARGET && (
          <TargetStep
            selectedTarget={selectedTarget}
            repo={repo}
            onSelect={setSelectedTarget}
          />
        )}
        {step === STEP_PREVIEW && (
          <PreviewStep
            previewFiles={previewFiles}
            editedContents={editedContents}
            isPending={previewMutation.isPending}
            isError={previewMutation.isError}
            error={previewMutation.error}
            repo={repo}
            onGenerate={handleGeneratePreview}
            onEdit={(path, content) =>
              setEditedContents((prev) => ({ ...prev, [path]: content }))
            }
          />
        )}
        {step === STEP_CONFIGURE && (
          <ConfigureStep
            triggerOpened={triggerOpened}
            onTriggerOpenedChange={setTriggerOpened}
            triggerSynchronize={triggerSynchronize}
            onTriggerSynchronizeChange={setTriggerSynchronize}
            triggerReopened={triggerReopened}
            onTriggerReopenedChange={setTriggerReopened}
            postAs={postAs}
            onPostAsChange={setPostAs}
          />
        )}
        {step === STEP_INSTALL && (
          <InstallStep
            installResult={installResult}
            repo={repo}
            previewFiles={previewFiles}
            isPending={installMutation.isPending}
            isError={installMutation.isError}
            error={installMutation.error}
            onOpenPr={handleOpenPr}
            onDownload={handleDownloadFiles}
          />
        )}
      </div>
    </Modal>
  );
}
