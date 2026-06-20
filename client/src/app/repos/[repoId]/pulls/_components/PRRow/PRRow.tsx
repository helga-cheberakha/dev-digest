/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { RunCostBadge } from "@/components/RunCostBadge";
import { FindingsBadge } from "@/components/FindingsBadge/FindingsBadge";
import { FindingsPopup } from "@/components/FindingsPopup/FindingsPopup";
import { usePrReviews } from "@/lib/hooks/reviews";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

function FindingsCell({ pr }: { pr: PrMeta }) {
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  // Fetch reviews when popup is opened (lazy); stable key so cache survives close/reopen
  const { data: reviews, isLoading } = usePrReviews(pr.id, { enabled: open });

  const findings = React.useMemo(() => {
    if (!reviews) return undefined;
    return reviews.flatMap((rv) => rv.findings).sort((a, b) => {
      const rank: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
      return (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0);
    });
  }, [reviews]);

  const handleClose = React.useCallback(() => setOpen(false), []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!pr.findings_counts) return;
    setRect(ref.current?.getBoundingClientRect() ?? null);
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleClick}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: pr.findings_counts ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <FindingsBadge counts={pr.findings_counts} />
      </button>
      {open && rect && (
        <FindingsPopup
          findings={findings}
          loading={isLoading && !findings}
          anchorRect={rect}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div>
        <FindingsCell pr={pr} />
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostBadge variant="compact" cost={pr.cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
