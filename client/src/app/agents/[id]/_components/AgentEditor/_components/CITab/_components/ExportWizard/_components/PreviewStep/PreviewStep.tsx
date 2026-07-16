"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";

export interface PreviewStepProps {
  previewFiles: CiFile[];
  editedContents: Record<string, string>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  repo: string;
  onGenerate: () => void;
  onEdit: (path: string, content: string) => void;
}

export function PreviewStep({
  previewFiles,
  editedContents,
  isPending,
  isError,
  error,
  repo,
  onGenerate,
  onEdit,
}: PreviewStepProps) {
  const t = useTranslations("ci");
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
            onClick={onGenerate}
            disabled={!repo || isPending}
          >
            {isPending
              ? t("exportWizard.previewLoading")
              : t("exportWizard.generatePreview")}
          </Button>
          {isError && (
            <p role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
              {String(error)}
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
                  onChange={(e) => onEdit(f.path, e.target.value)}
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
