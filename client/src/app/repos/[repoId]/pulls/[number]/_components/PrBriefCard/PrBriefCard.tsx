/* PrBriefCard — Why+Risk Brief card (rework, L05). Default-exported so the
   orchestrator can mount it in the PR-detail Overview tab. Renders: a
   risk_level-coloured banner with what/why + Regenerate (AC-10/AC-15); a
   metrics row from the latest completed review, or an AC-12 nudge when none
   exists. Review Focus has moved to a standalone component (see ReviewFocusCard).
   Fetches its own Brief + Reviews and owns its own loading/error/skeleton states (m6). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, Skeleton, ErrorState, type IconName } from "@devdigest/ui";
import type { Brief, ReviewRecord } from "@devdigest/shared";
import { usePrBrief, useRegenerateBrief } from "../../../../../../../lib/hooks/brief";
import { usePrReviews } from "../../../../../../../lib/hooks/reviews";
import { formatCost } from "../../../../../../../lib/cost";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { RISK_LEVEL_META, METRIC_ICONS } from "./constants";
import { s } from "./styles";

function formatTokens(tokensIn: number | null, tokensOut: number | null): string {
  if (tokensIn == null && tokensOut == null) return "—";
  return `${(tokensIn ?? 0).toLocaleString()} → ${(tokensOut ?? 0).toLocaleString()}`;
}

// ---- Banner: risk_level + what/why + Regenerate (AC-10/AC-15) -------------

function Banner({
  brief,
  onRegenerate,
  regenerating,
  regenerateFailed,
}: {
  brief: Brief;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateFailed: boolean;
}) {
  const t = useTranslations("prBrief");
  const meta = RISK_LEVEL_META[brief.risk_level];
  const RiskIcon = Icon[meta.icon];

  return (
    <div style={s.banner(meta.color, meta.bg)}>
      <div style={s.bannerHeader}>
        <div style={s.bannerBadgeRow}>
          <RiskIcon size={16} style={{ color: meta.color }} />
          <Badge color={meta.color} bg="transparent">
            {t(`riskLevel.${brief.risk_level}`)}
          </Badge>
        </div>
        <Button kind="secondary" size="sm" icon="RefreshCw" loading={regenerating} onClick={onRegenerate}>
          {regenerating ? t("regenerating") : t("regenerate")}
        </Button>
      </div>
      <p style={s.whatText}>{brief.what}</p>
      <p style={s.whyText}>{brief.why}</p>
      {regenerateFailed && <span style={s.regenerateError}>{t("regenerateError")}</span>}
    </div>
  );
}

// ---- Metrics row from the latest completed review (AC-11) -----------------

function MetricItem({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const I = Icon[icon];
  return (
    <div style={s.metricItem}>
      <I size={16} style={s.metricIcon} />
      <div style={s.metricCol}>
        <span style={s.metricLabel}>{label}</span>
        <span className="tnum" style={s.metricValue}>
          {value}
        </span>
      </div>
    </div>
  );
}

function MetricsRow({ review }: { review: ReviewRecord }) {
  const t = useTranslations("prBrief");
  const findingsCount = review.findings.length;
  const blockers = review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;

  return (
    <div style={s.metricsRow}>
      <MetricItem icon={METRIC_ICONS.findings} label={t("metrics.findings")} value={String(findingsCount)} />
      <MetricItem icon={METRIC_ICONS.blockers} label={t("metrics.blockers")} value={String(blockers)} />
      <MetricItem
        icon={METRIC_ICONS.score}
        label={t("metrics.score")}
        value={review.score != null ? String(review.score) : "—"}
      />
      <MetricItem icon={METRIC_ICONS.cost} label={t("metrics.cost")} value={formatCost(review.cost_usd)} />
      <MetricItem
        icon={METRIC_ICONS.tokens}
        label={t("metrics.tokens")}
        value={formatTokens(review.tokens_in, review.tokens_out)}
      />
    </div>
  );
}

// ---- No completed review yet — nudge reusing Run Review (AC-12) -----------

function ReviewNudge({ prId }: { prId: string }) {
  const t = useTranslations("prBrief");
  return (
    <div style={s.nudge}>
      <span style={s.nudgeText}>{t("reviewNotRun")}</span>
      <RunReviewDropdown prId={prId} size="sm" />
    </div>
  );
}

// ---- Public component -------------------------------------------------------

export interface PrBriefCardProps {
  prId: string;
}

/** PR Brief Card — risk banner (what/why) + latest-review metrics. */
export function PrBriefCard({ prId }: PrBriefCardProps) {
  const t = useTranslations("prBrief");
  const { data: brief, isLoading, isError, error, refetch } = usePrBrief(prId);
  const { data: reviews } = usePrReviews(prId);
  const regenerate = useRegenerateBrief(prId);

  const latestReview = React.useMemo(
    () => (reviews ?? []).find((r) => r.kind === "review") ?? null,
    [reviews],
  );

  if (isLoading) {
    return (
      <div style={s.loadingStack}>
        <Skeleton height={110} />
        <Skeleton height={64} />
      </div>
    );
  }

  if (isError || !brief) {
    return (
      <ErrorState
        title={t("unavailable")}
        body={(error as Error | undefined)?.message ?? t("unavailableHint")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div style={s.root}>
      <Banner
        brief={brief}
        onRegenerate={() => regenerate.mutate()}
        regenerating={regenerate.isPending}
        regenerateFailed={regenerate.isError}
      />

      {latestReview ? <MetricsRow review={latestReview} /> : <ReviewNudge prId={prId} />}
    </div>
  );
}

export default PrBriefCard;
