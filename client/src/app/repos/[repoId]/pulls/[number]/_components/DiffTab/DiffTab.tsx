"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile, SmartDiff, FindingRecord } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  smartDiff?: SmartDiff | null;
  /** All findings from the latest review — used to annotate files in smart order. */
  allFindings?: FindingRecord[];
  /** Navigate to a specific finding (switches tab + scrolls to finding). */
  onNavigateToFinding?: (findingId: string) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  smartDiff,
  allFindings = [],
  onNavigateToFinding,
}: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Default to smart order when smart diff data is available; track as ref so
  // it doesn't auto-flip back to smart if the user picks original order.
  const defaultedRef = React.useRef(false);
  const [viewMode, setViewMode] = React.useState<"smart" | "original">("original");

  React.useEffect(() => {
    if (smartDiff && !defaultedRef.current) {
      defaultedRef.current = true;
      setViewMode("smart");
    }
  }, [smartDiff]);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={s.headerRight}>
            {smartDiff && (
              <div style={s.toggleGroup}>
                <button
                  style={{
                    ...s.toggleBtn,
                    ...(viewMode === "smart" ? s.toggleBtnActive : {}),
                  }}
                  onClick={() => setViewMode("smart")}
                >
                  Smart order
                </button>
                <button
                  style={{
                    ...s.toggleBtn,
                    ...(viewMode === "original" ? s.toggleBtnActive : {}),
                    borderRight: "none",
                  }}
                  onClick={() => setViewMode("original")}
                >
                  Original order
                </button>
              </div>
            )}
            {commentCount > 0 && viewMode === "original" && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>

      {viewMode === "smart" && smartDiff ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          allFindings={allFindings}
          files={files}
          onNavigateToFinding={onNavigateToFinding ?? (() => {})}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  toggleGroup: {
    display: "flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  },
  toggleBtn: {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    border: "none",
    borderRight: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  toggleBtnActive: {
    background: "var(--surface-2)",
    color: "var(--text)",
  },
};
