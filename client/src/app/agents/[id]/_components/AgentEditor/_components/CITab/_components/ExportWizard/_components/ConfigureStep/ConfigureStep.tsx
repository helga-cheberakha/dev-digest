"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel } from "@devdigest/ui";

type PostAs = "github_review" | "pr_comment" | "none";

export interface ConfigureStepProps {
  triggerOpened: boolean;
  onTriggerOpenedChange: (v: boolean) => void;
  triggerSynchronize: boolean;
  onTriggerSynchronizeChange: (v: boolean) => void;
  triggerReopened: boolean;
  onTriggerReopenedChange: (v: boolean) => void;
  postAs: PostAs;
  onPostAsChange: (v: PostAs) => void;
}

export function ConfigureStep({
  triggerOpened,
  onTriggerOpenedChange,
  triggerSynchronize,
  onTriggerSynchronizeChange,
  triggerReopened,
  onTriggerReopenedChange,
  postAs,
  onPostAsChange,
}: ConfigureStepProps) {
  const t = useTranslations("ci");

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Triggers */}
      <div>
        <SectionLabel>{t("exportWizard.triggerLabel")}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(
            [
              { key: "opened", label: "exportWizard.triggers.opened", value: triggerOpened, onChange: onTriggerOpenedChange },
              { key: "synchronize", label: "exportWizard.triggers.synchronize", value: triggerSynchronize, onChange: onTriggerSynchronizeChange },
              { key: "reopened", label: "exportWizard.triggers.reopened", value: triggerReopened, onChange: onTriggerReopenedChange },
            ] as const
          ).map(({ key, label, value, onChange }) => (
            <label
              key={key}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={t(label as Parameters<typeof t>[0])}
              />
              <span>{t(label as Parameters<typeof t>[0])}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Secrets */}
      <div>
        <SectionLabel>{t("exportWizard.secretsLabel")}</SectionLabel>
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
        <SectionLabel>{t("exportWizard.postResultsLabel")}</SectionLabel>
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
                onChange={() => onPostAsChange(value)}
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
