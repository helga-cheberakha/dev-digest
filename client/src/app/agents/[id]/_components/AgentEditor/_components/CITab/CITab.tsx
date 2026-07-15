/*
 * CITab — CI deployment status + "Fail CI on" control for an agent.
 *
 * Empty state (no installations): shows title + CTA "Add to CI" that opens the wizard.
 * Installed state: shows badge, installation rows, "Fail CI on" control, action buttons.
 *
 * "Update CI config" and "Add repository" both open the Export Wizard against
 * the active repo (action: 'open_pr') — no separate update endpoint exists.
 */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useCiInstallations } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ExportWizard } from "./_components/ExportWizard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable target label for a CI installation row. */
function targetLabel(t: CiTarget): string {
  return { gha: "GitHub Actions", circle: "CircleCI", jenkins: "Jenkins", cli: "CLI" }[t] ?? t;
}

type CiTarget = "gha" | "circle" | "jenkins" | "cli";

// ---------------------------------------------------------------------------
// Fail CI on selector
// ---------------------------------------------------------------------------

const FAIL_ON_OPTIONS: CiFailOn[] = ["never", "critical", "warning", "any"];

function FailOnControl({
  agentId,
  value,
  t,
}: {
  agentId: string;
  value: CiFailOn;
  t: ReturnType<typeof useTranslations>;
}) {
  const update = useUpdateAgent();

  function handleChange(next: CiFailOn) {
    update.mutate({ id: agentId, patch: { ci_fail_on: next } });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("ciTab.failOnLabel")}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FAIL_ON_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            onClick={() => handleChange(opt)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: value === opt ? "2px solid var(--accent)" : "1px solid var(--border)",
              background: value === opt ? "var(--accent-bg, rgba(99,102,241,0.08))" : "transparent",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: value === opt ? 600 : 400,
              color: "var(--text-primary)",
            }}
          >
            {t(`ciTab.failOn.${opt}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
        {t("ciTab.failOnHelper")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CITab component
// ---------------------------------------------------------------------------

export function CITab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const { data: installations, isLoading } = useCiInstallations(agent.id);
  const [wizardOpen, setWizardOpen] = useState(false);

  const hasInstallations = (installations?.length ?? 0) > 0;

  if (isLoading) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={24} width={180} />
        <Skeleton height={100} />
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 640 }}>
      {/* Empty state */}
      {!hasInstallations && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <Icon.Workflow size={36} style={{ color: "var(--text-muted)" }} />
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>
              {t("ciTab.emptyTitle")}
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
              {t("ciTab.emptyBody")}
            </p>
          </div>
          <Button kind="primary" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("ciTab.emptyCta")}
          </Button>
        </div>
      )}

      {/* Installed state */}
      {hasInstallations && (
        <>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
              {t("ciTab.ciDeployment")}
            </h2>
            <Badge color="var(--ok)">
              {t("ciTab.activeBadge", { count: String(installations!.length) })}
            </Badge>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => setWizardOpen(true)}>
                {t("ciTab.updateConfig")}
              </Button>
              <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
                {t("ciTab.addRepo")}
              </Button>
            </div>
          </div>

          {/* Installation rows */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {installations!.map((inst) => (
              <div
                key={inst.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 14,
                }}
              >
                <Icon.GitBranch size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{inst.repo}</span>
                <Badge color="var(--text-muted)">{targetLabel(inst.target_type as CiTarget)}</Badge>
                <Badge color="var(--ok)">active</Badge>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("ciTab.installed", {
                    date: new Date(inst.installed_at).toLocaleDateString(),
                  })}
                </span>
              </div>
            ))}
            {/* Dashed "Add repository" button at bottom */}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "12px 16px",
                border: "none",
                borderTop: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                color: "var(--text-muted)",
                outline: "2px dashed var(--border-strong)",
                outlineOffset: -2,
              }}
            >
              <Icon.Plus size={14} />
              {t("ciTab.addRepo")}
            </button>
          </div>

          {/* Fail CI on */}
          <div
            style={{
              padding: "16px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-elevated)",
            }}
          >
            <FailOnControl agentId={agent.id} value={agent.ci_fail_on} t={t} />
          </div>
        </>
      )}

      {/* Export Wizard */}
      {wizardOpen && (
        <ExportWizard
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
