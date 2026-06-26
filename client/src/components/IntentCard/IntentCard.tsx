"use client";

import React from "react";
import { Icon, SectionLabel, Badge } from "@devdigest/ui";
import { usePrIntent, useClassifyIntent } from "@/lib/hooks/intent";
import type { PrIntentRecord } from "@devdigest/shared";

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

// ---- Populated intent card -----------------------------------------------

function IntentFilled({
  intent,
  onRefresh,
  loading,
}: {
  intent: PrIntentRecord;
  onRefresh: () => void;
  loading: boolean;
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

      {intent.risk_areas && intent.risk_areas.length > 0 && (
        <div style={s.riskRow}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span style={s.riskLabel}>RISK AREAS</span>
          <div style={s.riskBadges}>
            {intent.risk_areas.map((area) => (
              <Badge key={area} color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Public component -------------------------------------------------------

export function IntentCard({ prId }: { prId: string | null | undefined }) {
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
    />
  );
}

// ---- Styles -----------------------------------------------------------------

const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    marginBottom: 16,
  },
  summary: {
    fontStyle: "italic",
    fontSize: 14,
    color: "var(--text-primary)",
    margin: "0 0 16px",
    lineHeight: 1.5,
  },
  columns: {
    display: "flex",
    gap: 24,
    flexWrap: "wrap" as const,
  },
  col: {
    flex: 1,
    minWidth: 180,
  },
  colHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  scopeItem: {
    display: "flex",
    gap: 6,
    marginBottom: 6,
    alignItems: "flex-start",
  },
  scopeText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  },
  riskRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    flexWrap: "wrap" as const,
  },
  riskLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--warn)",
  },
  riskBadges: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap" as const,
  },
  emptyRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  muted: {
    fontSize: 13,
    color: "var(--text-muted)",
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSmall: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    background: "var(--bg-hover)",
  },
  spinning: {
    animation: "ddspin 1s linear infinite",
  },
} as const;
