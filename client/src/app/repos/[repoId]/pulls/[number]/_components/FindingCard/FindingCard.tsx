/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { Tooltip } from "@/components/Tooltip";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  onCreateEvalCase,
  pending,
  repoFullName,
  headSha,
  hasEvalCase,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  onCreateEvalCase?: (findingId: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Whether an eval case already exists for this finding — when true, the
   *  "Turn into eval case" control opens that case instead of drafting a
   *  duplicate. */
  hasEvalCase?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header(muted)}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Tooltip label={accepted ? t("finding.alreadyAcceptedHint") : undefined}>
              <Button
                kind="secondary"
                size="sm"
                icon="Check"
                disabled={pending || accepted}
                active={accepted}
                style={accepted ? { borderColor: "var(--ok)", color: "var(--ok)" } : undefined}
                onClick={() => onAction?.("accept")}
              >
                {t("finding.accept")}
              </Button>
            </Tooltip>
            <Tooltip label={dismissed ? t("finding.alreadyDismissedHint") : undefined}>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                disabled={pending || dismissed}
                active={dismissed}
                onClick={() => onAction?.("dismiss")}
              >
                {t("finding.dismiss")}
              </Button>
            </Tooltip>
            <Tooltip
              label={
                !muted
                  ? t("finding.turnIntoEvalCaseDisabledHint")
                  : hasEvalCase
                    ? t("finding.evalCaseAlreadyCreatedHint")
                    : undefined
              }
            >
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                disabled={!muted}
                active={hasEvalCase}
                style={hasEvalCase ? { borderColor: "var(--ok)", color: "var(--ok)" } : undefined}
                aria-label={
                  hasEvalCase
                    ? t("finding.viewEvalCaseAria")
                    : t("finding.turnIntoEvalCaseAria")
                }
                onClick={() => onCreateEvalCase?.(f.id)}
              >
                {hasEvalCase ? t("finding.viewEvalCase") : t("finding.turnIntoEvalCase")}
              </Button>
              {!muted && (
                <Icon.Info
                  size={11}
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    color: "var(--text-muted)",
                    background: "var(--bg-elevated)",
                    borderRadius: "50%",
                    border: "1px solid var(--border-strong)",
                  }}
                />
              )}
              {muted && hasEvalCase && (
                <Icon.CheckCircle
                  size={11}
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    color: "var(--ok)",
                    background: "var(--bg-elevated)",
                    borderRadius: "50%",
                  }}
                />
              )}
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
