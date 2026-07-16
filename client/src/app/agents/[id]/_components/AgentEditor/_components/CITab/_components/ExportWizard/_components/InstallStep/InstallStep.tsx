"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { CiExport, CiFile } from "@devdigest/shared";

export interface InstallStepProps {
  installResult: CiExport | null;
  repo: string;
  previewFiles: CiFile[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onOpenPr: () => void;
  onDownload: () => void;
}

export function InstallStep({
  installResult,
  repo,
  previewFiles,
  isPending,
  isError,
  error,
  onOpenPr,
  onDownload,
}: InstallStepProps) {
  const t = useTranslations("ci");

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

      {isError && (
        <p role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
          {String(error)}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button
          kind="primary"
          onClick={onOpenPr}
          disabled={!repo || isPending}
          icon="GitPullRequest"
        >
          {isPending
            ? t("exportWizard.installing")
            : t("exportWizard.openPrAction")}
        </Button>
        {previewFiles.length > 0 && (
          <Button kind="secondary" onClick={onDownload} icon="Copy">
            {t("exportWizard.downloadFiles")}
          </Button>
        )}
      </div>
    </div>
  );
}
