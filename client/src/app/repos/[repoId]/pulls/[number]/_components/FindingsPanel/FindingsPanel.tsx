/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2) and eval-case draft flow (TC3). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, EvalCaseInput, EvalCaseListItem } from "@devdigest/shared";
import { EvalInputMeta } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { draftEvalCaseFromFinding, fetchEvalCases, evalQueryKeys } from "../../../../../../../lib/api";
import { EvalCaseModal } from "@/components/EvalCaseModal";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

/** Case-list rows keyed by the finding they were seeded from, so an already-
 *  created case can be opened directly instead of drafting a duplicate. */
function indexByFindingId(cases: EvalCaseListItem[]): Map<string, EvalCaseListItem> {
  const byFinding = new Map<string, EvalCaseListItem>();
  for (const c of cases) {
    const meta = EvalInputMeta.safeParse(c.input_meta);
    if (meta.success && !byFinding.has(meta.data.source_finding_id)) {
      byFinding.set(meta.data.source_finding_id, c);
    }
  }
  return byFinding;
}

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId = null,
  agentId = null,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Finding to focus (scroll to + expand) on mount/param change. */
  targetFindingId?: string | null;
  /** The review's owning agent — used to look up whether a finding already
   *  has an eval case, so "Turn into eval case" can open the existing case
   *  instead of drafting a duplicate. Null for reviews with no owning agent
   *  (e.g. legacy/ad-hoc runs) — the lookup is simply skipped. */
  agentId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const qc = useQueryClient();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const [modal, setModal] = React.useState<{ initial: EvalCaseInput; caseId?: string } | null>(
    null,
  );

  const { data: evalCases } = useQuery({
    queryKey: evalQueryKeys.cases(agentId ?? ""),
    queryFn: () => fetchEvalCases(agentId!),
    enabled: !!agentId,
  });
  const caseByFindingId = React.useMemo(
    () => indexByFindingId(evalCases ?? []),
    [evalCases],
  );

  const draftMutation = useMutation({
    mutationFn: draftEvalCaseFromFinding,
    onSuccess: (data) => setModal({ initial: data }),
  });

  const handleCreateEvalCase = React.useCallback(
    (findingId: string) => {
      const existing = caseByFindingId.get(findingId);
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { latest_run, ...initial } = existing;
        setModal({ initial, caseId: existing.id });
      } else {
        draftMutation.mutate(findingId);
      }
    },
    [caseByFindingId, draftMutation],
  );

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);

  // Focus a specific finding (from a findings popover / deep-link): move the
  // keyboard focus index to it and scroll its card into view.
  React.useEffect(() => {
    if (!targetFindingId) return;
    const idx = shown.findIndex((f) => f.id === targetFindingId);
    if (idx < 0) return;
    setFocusIdx(idx);
    const id = window.setTimeout(() => {
      document
        .querySelector(`[data-finding-id="${targetFindingId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [targetFindingId, shown]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0 || f.id === targetFindingId}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              hasEvalCase={caseByFindingId.has(f.id)}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              onCreateEvalCase={handleCreateEvalCase}
            />
          ))
        )}
      </div>

      {modal && (
        <EvalCaseModal
          initial={modal.initial}
          caseId={modal.caseId}
          onSaved={() => {
            // A save (new case, or a "Run case" on an existing one) can
            // change whether/what this panel's "hasEvalCase" lookup sees —
            // without this the button only picks up the new case after a
            // full page reload (the query is otherwise cached for 30s).
            if (agentId) void qc.invalidateQueries({ queryKey: evalQueryKeys.cases(agentId) });
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
