"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CI_TARGETS = ["gha"] as const satisfies readonly CiTarget[];

const TARGET_DESC_KEY = {
  gha: "exportWizard.targets.ghaDesc",
} as const;

const TARGET_LABEL_KEY = {
  gha: "exportWizard.targets.gha",
} as const;

// ---------------------------------------------------------------------------
// TargetCard sub-component
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
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
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
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "var(--accent-bg)",
          color: "var(--accent)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icon.Workflow size={18} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
          {recommendedLabel && (
            <Badge color="var(--ok)">{recommendedLabel}</Badge>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{desc}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// TargetStep
// ---------------------------------------------------------------------------

export interface TargetStepProps {
  selectedTarget: CiTarget;
  repo: string;
  onSelect: (target: CiTarget) => void;
}

export function TargetStep({ selectedTarget, repo, onSelect }: TargetStepProps) {
  const t = useTranslations("ci");

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
            label={t(TARGET_LABEL_KEY[target] as Parameters<typeof t>[0])}
            desc={t(TARGET_DESC_KEY[target] as Parameters<typeof t>[0])}
            selected={selectedTarget === target}
            recommendedLabel={target === "gha" ? t("exportWizard.recommended") : undefined}
            onSelect={() => onSelect(target)}
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
