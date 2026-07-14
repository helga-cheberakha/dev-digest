/* CompareRunsModal — side-by-side metric deltas + system-prompt diff for two
   selected batch runs, with a Promote action. `oldBatch`/`newBatch` are
   pre-sorted by the caller (oldBatch = earlier ran_at) so `delta = new − old`
   always reads in the conventional direction regardless of click order. */
"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Modal, Button, SectionLabel, Icon, Skeleton } from "@devdigest/ui";
import { fetchEvalCompare, promoteVersion, evalQueryKeys } from "@/lib/api";
import { formatCost } from "@/lib/cost";
import type { EvalRunBatch } from "@devdigest/shared";
import { highlightAdditions } from "../lineDiff";

type Direction = "up" | "down" | "flat";

function directionOf(delta: number): Direction {
  return delta === 0 ? "flat" : delta > 0 ? "up" : "down";
}

function pctMetric(oldV: number, newV: number, delta: number) {
  return {
    oldDisplay: `${Math.round(oldV * 100)}%`,
    newDisplay: `${Math.round(newV * 100)}%`,
    deltaDisplay: `${Math.round(Math.abs(delta) * 100)}pt`,
    direction: directionOf(delta),
  };
}

function costMetric(oldV: number, newV: number, delta: number) {
  return {
    oldDisplay: formatCost(oldV),
    newDisplay: formatCost(newV),
    deltaDisplay: formatCost(Math.abs(delta)),
    direction: directionOf(delta),
  };
}

function CompareMetric({
  label,
  oldDisplay,
  newDisplay,
  deltaDisplay,
  direction,
}: {
  label: string;
  oldDisplay: string;
  newDisplay: string;
  deltaDisplay: string;
  direction: Direction;
}) {
  const color =
    direction === "flat" ? "var(--text-muted)" : direction === "up" ? "var(--ok)" : "var(--crit)";
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 14,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.03em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="tnum" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {oldDisplay}
        </span>
        <Icon.ArrowRight size={12} style={{ color: "var(--text-muted)" }} />
        <span className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>
          {newDisplay}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color }}>
        {direction === "flat" ? "—" : `${direction === "up" ? "▲" : "▼"} ${deltaDisplay}`}
      </div>
    </div>
  );
}

interface Props {
  agentId: string;
  casesTotal: number;
  oldBatch: EvalRunBatch;
  newBatch: EvalRunBatch;
  onClose: () => void;
}

export function CompareRunsModal({ agentId, casesTotal, oldBatch, newBatch, onClose }: Props) {
  const t = useTranslations("eval");
  const qc = useQueryClient();
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: evalQueryKeys.compare(agentId, oldBatch.batch_id, newBatch.batch_id),
    queryFn: () => fetchEvalCompare(agentId, oldBatch.batch_id, newBatch.batch_id),
  });

  const oldV = oldBatch.agent_version;
  const newV = newBatch.agent_version;

  async function handlePromote() {
    if (newV == null || promoting) return;
    setPromoting(true);
    try {
      await promoteVersion(agentId, newV);
      setPromoted(true);
      void qc.invalidateQueries({ queryKey: ["agent", agentId] });
      void qc.invalidateQueries({ queryKey: evalQueryKeys.batches(agentId) });
      void qc.invalidateQueries({ queryKey: evalQueryKeys.dashboard(agentId) });
    } finally {
      setPromoting(false);
    }
  }

  const promptDiff = data?.prompt_diff as { old: string | null; new: string | null } | null;
  const diffLines =
    promptDiff?.old != null && promptDiff?.new != null
      ? highlightAdditions(promptDiff.old, promptDiff.new)
      : null;

  return (
    <Modal
      width={780}
      title={t("compare.title", { old: oldV ?? "—", new: newV ?? "—" })}
      subtitle={t("compare.subtitle", { count: casesTotal })}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
          <Button
            kind="primary"
            icon="GitBranch"
            disabled={newV == null || promoting || promoted}
            onClick={() => void handlePromote()}
          >
            {promoting
              ? t("compare.promoting")
              : promoted
                ? t("compare.promoted")
                : t("compare.promote", { version: newV ?? "?" })}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        {isLoading || !data ? (
          <Skeleton height={220} />
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <CompareMetric
                label={t("compare.metrics.recall")}
                {...pctMetric(data.a.recall, data.b.recall, data.delta.recall)}
              />
              <CompareMetric
                label={t("compare.metrics.precision")}
                {...pctMetric(data.a.precision, data.b.precision, data.delta.precision)}
              />
              <CompareMetric
                label={t("compare.metrics.citation")}
                {...pctMetric(data.a.citation_accuracy, data.b.citation_accuracy, data.delta.citation_accuracy)}
              />
              <CompareMetric
                label={t("compare.metrics.cost")}
                {...costMetric(data.a.cost_usd, data.b.cost_usd, data.delta.cost_usd)}
              />
            </div>

            <SectionLabel icon="FileText">{t("compare.systemPromptDiff")}</SectionLabel>
            <div
              style={{
                display: "flex",
                gap: 16,
                marginBottom: 8,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--crit)" }} />
                {t("compare.oldLabel", { version: oldV ?? "—" })}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--ok)" }} />
                {t("compare.newLabel", { version: newV ?? "—" })}
              </span>
            </div>

            {diffLines ? (
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 16,
                  fontFamily: "monospace",
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  maxHeight: 280,
                  overflow: "auto",
                }}
              >
                {diffLines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      fontWeight: l.added ? 700 : 400,
                      color: l.added ? "var(--text-primary)" : "var(--text-secondary)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {l.text || " "}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("compare.noPrompt")}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
