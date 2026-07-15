/* RunReviewDropdown — multi-select agent picker.
   Opens a checklist of enabled agents; single selection uses the existing
   single-agent run path (no multi_agent_runs record); 2+ uses the new
   multi-agent endpoint and navigates to /multi-agent/<id>. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import type { AgentEstimate } from "@devdigest/shared";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunReview } from "../../../../../../../lib/hooks/reviews";
import {
  useAgentEstimates,
  useLaunchMultiAgentRun,
} from "../../../../../../../lib/hooks/multiAgent";
import { formatCost } from "../../../../../../../lib/cost";
import { DROPDOWN_WIDTH } from "./constants";

/** Human-readable duration estimate from milliseconds. Mirrors formatCost's
    null→"—" contract so the UI is consistent: no fabricated numbers. */
function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const run = useRunReview();
  const launch = useLaunchMultiAgentRun();

  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const ref = React.useRef<HTMLDivElement>(null);

  // Only enabled agents appear in the picker
  const enabledAgents = React.useMemo(
    () => (agents ?? []).filter((a) => a.enabled),
    [agents],
  );

  // Estimate lookup by agent_id
  const estimateMap = React.useMemo(() => {
    const m = new Map<string, AgentEstimate>();
    for (const e of estimates ?? []) m.set(e.agent_id, e);
    return m;
  }, [estimates]);

  // Close panel on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const checkedIds = enabledAgents.filter((a) => checked.has(a.id)).map((a) => a.id);
  const checkedCount = checkedIds.length;
  const allSelected =
    enabledAgents.length > 0 && enabledAgents.every((a) => checked.has(a.id));
  const isPending = run.isPending || launch.isPending;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setChecked(new Set(enabledAgents.map((a) => a.id)));
  const clearAll = () => setChecked(new Set<string>());

  const handleRun = async () => {
    onRunStart?.();
    setOpen(false);
    try {
      if (checkedCount === 1) {
        // N=1: existing single-agent path — must NOT create a multi_agent_runs record
        const res = await run.mutateAsync({ prId, agentId: checkedIds[0] });
        onRunsStarted?.(res.runs.map((r) => r.run_id));
      } else if (checkedCount >= 2) {
        // N≥2: multi-agent path → navigate to results page
        const res = await launch.mutateAsync({ prId, agent_ids: checkedIds });
        onRunsStarted?.(res.run_ids);
        router.push(`/multi-agent/${res.id}`);
      }
    } finally {
      onRunSettled?.();
    }
  };

  // Action button label derived from selection count (never hardcoded numbers)
  const singleAgentName =
    checkedCount === 1
      ? (enabledAgents.find((a) => a.id === checkedIds[0])?.name ?? "")
      : "";
  const actionLabel =
    checkedCount === 0
      ? t("runReview.runReview")
      : checkedCount === 1
        ? t("runReview.runSingleAgent", { name: singleAgentName })
        : t("runReview.runMultiAgent", { count: checkedCount });

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger — same button slot as before */}
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Button kind={kind} size={size} iconRight="ChevronDown" icon="Sparkles" loading={isPending}>
          {isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: DROPDOWN_WIDTH,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 6,
            zIndex: 40,
          }}
        >
          {/* Merged warning (same as before, now inline) */}
          {warnMerged && (
            <div style={{ padding: "4px 10px 2px", fontSize: 12, color: "var(--text-secondary)" }}>
              {t("runReview.mergedWarning")}
            </div>
          )}

          {/* Header: label + Select all / Clear */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              {t("runReview.pickAgents")}
            </span>
            <button
              onClick={allSelected ? clearAll : selectAll}
              style={{
                fontSize: 12,
                color: "var(--accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontWeight: 500,
              }}
            >
              {allSelected ? t("runReview.clearAll") : t("runReview.selectAll")}
            </button>
          </div>

          {/* Agent checklist — enabled agents only */}
          {enabledAgents.length === 0 ? (
            <div style={{ padding: "6px 10px", fontSize: 13, color: "var(--text-muted)" }}>
              {t("runReview.noEnabledAgents")}
            </div>
          ) : (
            enabledAgents.map((agent) => {
              const est = estimateMap.get(agent.id);
              const durationLabel = formatDurationMs(est?.est_duration_ms);
              const costLabel = formatCost(est?.est_cost_usd);
              return (
                <div key={agent.id} style={{ padding: "4px 10px" }}>
                  <Checkbox
                    checked={checked.has(agent.id)}
                    onChange={() => toggle(agent.id)}
                    label={
                      <span
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flex: 1,
                          gap: 6,
                          minWidth: 0,
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {agent.name}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {durationLabel} · {costLabel}
                        </span>
                      </span>
                    }
                  />
                </div>
              );
            })
          )}

          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />

          {/* Primary run action: 0→disabled, 1→single agent, 2+→multi */}
          <div style={{ padding: "2px 4px" }}>
            <button
              onClick={handleRun}
              disabled={checkedCount === 0 || isPending}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "none",
                background: checkedCount > 0 ? "var(--accent)" : "var(--bg-hover)",
                color: checkedCount > 0 ? "#fff" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: checkedCount > 0 ? "pointer" : "default",
                textAlign: "center",
              }}
            >
              {actionLabel}
            </button>
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />

          {/* Configure agents — navigates to /multi-agent/configure?prId=… */}
          <button
            onClick={() => {
              setOpen(false);
              router.push(`/multi-agent/configure?prId=${prId}`);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 14,
              fontWeight: 500,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {t("runReview.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
