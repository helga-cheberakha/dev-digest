"use client";

import React from "react";
import { Icon, SectionLabel } from "@devdigest/ui";
import { usePrIntent, useClassifyIntent } from "@/lib/hooks/intent";
import type { PrIntentRecord, Risk, RiskAreaKind, RiskSeverity } from "@devdigest/shared";
import { s } from "./styles";
import { type FileRefTarget, parseFileRef } from "@/lib/parseFileRef";

const KIND_ICON: Record<RiskAreaKind, keyof typeof Icon> = {
  security: "Shield",
  dependency: "Boxes",
  performance: "Gauge",
  data: "Database",
  api_change: "Code",
  other: "Info",
};

const SEVERITY_COLOR: Record<RiskSeverity, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)" },
};

// ---- Skeleton shown while loading -----------------------------------------

function IntentSkeleton() {
  return (
    <div style={s.card}>
      <SectionLabel icon="ListChecks">Intent</SectionLabel>
      <div style={{ ...s.skeletonLine, width: "70%", marginBottom: 16 }} />
      <div style={s.columns}>
        <div style={{ flex: 1 }}>
          {[60, 80, 50].map((w) => (
            <div key={w} style={{ ...s.skeletonLine, width: `${w}%`, marginBottom: 8 }} />
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {[70, 55].map((w) => (
            <div key={w} style={{ ...s.skeletonLine, width: `${w}%`, marginBottom: 8 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Null state (not yet classified) -------------------------------------

function IntentEmpty({ onClassify, loading }: { onClassify: () => void; loading: boolean }) {
  return (
    <div style={s.card}>
      <SectionLabel icon="ListChecks">Intent</SectionLabel>
      <div style={s.emptyRow}>
        <span style={s.muted}>Intent not yet classified for this PR.</span>
        <button style={s.btn} onClick={onClassify} disabled={loading}>
          {loading ? (
            <>
              <Icon.RefreshCw size={13} style={s.spinning} /> Classifying…
            </>
          ) : (
            <>
              <Icon.Sparkles size={13} /> Classify Intent
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---- Risk Areas accordion (AC-13) -----------------------------------------

function RiskAccordionItem({
  risk,
  onOpenFile,
}: {
  risk: Risk;
  onOpenFile?: (ref: FileRefTarget) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const KindIcon = Icon[KIND_ICON[risk.kind]];
  const sevColor = SEVERITY_COLOR[risk.severity];

  return (
    <div style={s.riskItem}>
      <button
        type="button"
        style={s.riskItemHeader}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <KindIcon size={14} style={{ color: sevColor.color, flexShrink: 0 }} />
        <span style={s.riskItemTitle}>{risk.title}</span>
        <Icon.ChevronDown size={14} style={s.riskChevron(expanded)} />
      </button>

      {risk.file_refs.length > 0 && (
        <div style={s.riskFileRefs}>
          {risk.file_refs.map((ref) => (
            <button
              key={ref}
              type="button"
              className="mono"
              style={s.riskFileRefBtn}
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile?.(parseFileRef(ref));
              }}
            >
              {ref}
            </button>
          ))}
        </div>
      )}

      {expanded && <p style={s.riskExplanation}>{risk.explanation}</p>}
    </div>
  );
}

function RiskAreasSection({
  risks,
  onOpenFile,
}: {
  risks: Risk[];
  onOpenFile?: (ref: FileRefTarget) => void;
}) {
  return (
    <div style={s.riskSection}>
      <div style={s.riskSectionHeader}>
        <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
        <span style={s.riskLabel}>RISK AREAS</span>
      </div>
      <div style={s.riskList}>
        {risks.map((risk, i) => (
          <RiskAccordionItem key={`${risk.kind}-${risk.title}-${i}`} risk={risk} onOpenFile={onOpenFile} />
        ))}
      </div>
    </div>
  );
}

// ---- Populated intent card -----------------------------------------------

function IntentFilled({
  intent,
  onRefresh,
  loading,
  risks,
  onOpenFile,
}: {
  intent: PrIntentRecord;
  onRefresh: () => void;
  loading: boolean;
  risks?: Risk[];
  onOpenFile?: (ref: FileRefTarget) => void;
}) {
  return (
    <div style={s.card}>
      <SectionLabel
        icon="ListChecks"
        right={
          <button style={s.btnSmall} onClick={onRefresh} disabled={loading} title="Re-classify intent">
            <Icon.RefreshCw size={12} style={loading ? s.spinning : undefined} />
            {loading ? " Classifying…" : " Refresh"}
          </button>
        }
      >
        Intent
      </SectionLabel>

      <p style={s.summary}>"{intent.summary}"</p>

      <div style={s.columns}>
        <div style={s.col}>
          <div style={s.colHeader}>
            <Icon.Check size={13} style={{ color: "var(--ok)" }} />
            <span style={{ color: "var(--ok)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em" }}>
              IN SCOPE
            </span>
          </div>
          {intent.in_scope.map((item) => (
            <div key={item} style={s.scopeItem}>
              <Icon.Check size={11} style={{ color: "var(--ok)", flexShrink: 0, marginTop: 2 }} />
              <span style={s.scopeText}>{item}</span>
            </div>
          ))}
        </div>

        <div style={s.col}>
          <div style={s.colHeader}>
            <Icon.X size={13} style={{ color: "var(--crit)" }} />
            <span style={{ color: "var(--crit)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em" }}>
              OUT OF SCOPE
            </span>
          </div>
          {intent.out_of_scope.map((item) => (
            <div key={item} style={s.scopeItem}>
              <Icon.X size={11} style={{ color: "var(--crit)", flexShrink: 0, marginTop: 2 }} />
              <span style={s.scopeText}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {risks && risks.length > 0 && <RiskAreasSection risks={risks} onOpenFile={onOpenFile} />}
    </div>
  );
}

// ---- Public component -------------------------------------------------------

export function IntentCard({
  prId,
  risks,
  onOpenFile,
}: {
  prId: string | null | undefined;
  /** Brief risk areas (owned by the caller — IntentCard does not fetch the Brief itself). */
  risks?: Risk[];
  /** Called when a risk's `file_ref` is clicked (AC-14 navigation, wired by the caller). */
  onOpenFile?: (ref: FileRefTarget) => void;
}) {
  const { data: intent, isLoading } = usePrIntent(prId);
  const classify = useClassifyIntent(prId);

  if (!prId || isLoading) return <IntentSkeleton />;

  if (!intent) {
    return (
      <IntentEmpty
        onClassify={() => classify.mutate()}
        loading={classify.isPending}
      />
    );
  }

  return (
    <IntentFilled
      intent={intent}
      onRefresh={() => classify.mutate()}
      loading={classify.isPending}
      risks={risks}
      onOpenFile={onOpenFile}
    />
  );
}
