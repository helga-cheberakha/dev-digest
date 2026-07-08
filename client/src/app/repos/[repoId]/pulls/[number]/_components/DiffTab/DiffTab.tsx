"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { SmartDiffViewer } from "@/components/SmartDiffViewer";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import { scrollToFocusedFile, type FocusFileTarget } from "./scrollToFocusedFile";
import type { FindingRecord, SmartDiff, PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  smartDiff: SmartDiff | null | undefined;
  /** All findings from the latest review — used to decorate SmartDiffViewer. */
  allFindings?: FindingRecord[];
  /** Called when the user clicks a finding badge — navigates to the Findings tab. */
  onNavigateToFinding?: (findingId: string) => void;
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** A Brief review-focus/risk `file_ref` to scroll to and highlight (AC-14). */
  focusFile?: FocusFileTarget;
}

export function DiffTab({ prId, filesCount, files, smartDiff, allFindings = [], onNavigateToFinding, canComment, focusFile }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const [showComments, setShowComments] = React.useState(false);
  const diffContainerRef = React.useRef<HTMLDivElement>(null);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true);
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // AC-14: `focusFile` arrives already switched into this tab by page.tsx.
  // Scroll to + highlight it (and its line, when present) once the diff
  // content is in the DOM; re-runs if the target or the underlying data
  // changes (e.g. smartDiff/files finish loading after the tab switch).
  React.useEffect(() => {
    if (!focusFile || !diffContainerRef.current) return;
    scrollToFocusedFile(diffContainerRef.current, focusFile);
  }, [focusFile?.path, focusFile?.line, smartDiff, files]);

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        Files changed · {filesCount} files{smartDiff ? " · Smart Diff (grouped by role)" : ""}
      </SectionLabel>
      <div ref={diffContainerRef}>
        {smartDiff && smartDiff.groups.length > 0 ? (
          <SmartDiffViewer
            smartDiff={smartDiff}
            allFindings={allFindings}
            files={files}
            onNavigateToFinding={onNavigateToFinding ?? (() => {})}
          />
        ) : (
          <DiffViewer files={files} commenting={commenting} />
        )}
      </div>
    </section>
  );
}
