"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import PrBriefCard from "../PrBriefCard";
import { IntentCard } from "@/components/IntentCard";
import { usePrBrief } from "@/lib/hooks/brief";
import { BlastRadiusSection } from "./BlastRadiusSection";
import { ReviewFocusSection } from "./ReviewFocusSection";
import type { FileRefTarget } from "@/lib/parseFileRef";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  onOpenFile: (ref: FileRefTarget) => void;
  onGoToBlast: () => void;
}

export function OverviewTab({ prId, prBody, onOpenFile, onGoToBlast }: OverviewTabProps) {
  // Reuses the SAME `["brief", prId]` query PrBriefCard fetches (deduped by
  // TanStack Query) — no second fetch (m6) — to feed IntentCard's Risk Areas
  // accordion (AC-13) with `brief.risks` and ReviewFocusSection (AC-14).
  const { data: brief } = usePrBrief(prId);

  return (
    <>
      {prId && <PrBriefCard prId={prId} />}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
      <div style={s.intentBlastGrid}>
        <IntentCard prId={prId} risks={brief?.risks} onOpenFile={onOpenFile} />
        <BlastRadiusSection prId={prId} onGoToBlast={onGoToBlast} />
      </div>
      <ReviewFocusSection items={brief?.review_focus ?? []} onOpenFile={onOpenFile} />
    </>
  );
}
