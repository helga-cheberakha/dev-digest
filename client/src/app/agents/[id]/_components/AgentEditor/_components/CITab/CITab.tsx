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
import type { Agent, CiFailOn, CiTarget } from "@devdigest/shared";
import { useCiInstallations } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ExportWizard } from "./_components/ExportWizard";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable target label for a CI installation row. */
function targetLabel(t: CiTarget): string {
  return { gha: "GitHub Actions", circle: "CircleCI", jenkins: "Jenkins", cli: "CLI" }[t] ?? t;
}

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
    <div style={s.failOnWrap}>
      <div style={s.failOnLabelRow}>
        <span style={s.failOnLabel}>{t("ciTab.failOnLabel")}</span>
      </div>
      <div style={s.failOnOptions}>
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
      <p style={s.failOnHelper}>
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
      <div style={s.loadingWrap}>
        <Skeleton height={24} width={180} />
        <Skeleton height={100} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      {/* Empty state */}
      {!hasInstallations && (
        <div style={s.emptyState}>
          <Icon.Workflow size={36} style={{ color: "var(--text-muted)" }} />
          <div>
            <h2 style={s.emptyH2}>
              {t("ciTab.emptyTitle")}
            </h2>
            <p style={s.emptyBody}>
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
          <div style={s.headerRow}>
            <h2 style={s.headerH2}>
              {t("ciTab.ciDeployment")}
            </h2>
            <Badge color="var(--ok)">
              {t("ciTab.activeBadge", { count: String(installations!.length) })}
            </Badge>
            <div style={s.headerActions}>
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => setWizardOpen(true)}>
                {t("ciTab.updateConfig")}
              </Button>
              <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
                {t("ciTab.addRepo")}
              </Button>
            </div>
          </div>

          {/* Installation rows */}
          <div style={s.instList}>
            {installations!.map((inst) => (
              <div key={inst.id} style={s.instRow}>
                <Icon.GitBranch size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span style={s.instRepoName}>{inst.repo}</span>
                <Badge color="var(--text-muted)">{targetLabel(inst.target_type)}</Badge>
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
              style={s.addRepoBtn}
            >
              <Icon.Plus size={14} />
              {t("ciTab.addRepo")}
            </button>
          </div>

          {/* Fail CI on */}
          <div style={s.failOnCard}>
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
