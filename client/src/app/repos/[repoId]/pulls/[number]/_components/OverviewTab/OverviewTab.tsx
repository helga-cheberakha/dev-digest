"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import PrBriefCard from "../PrBriefCard";
import { IntentCard } from "@/components/IntentCard";
import { usePrBrief } from "@/lib/hooks/brief";
import { BlastRadiusSection } from "./BlastRadiusSection";
import { s } from "./styles";

/** Navigation target derived from a `file_ref` (AC-14) — matches the shape
 *  PrBriefCard/IntentCard already call their `onOpenFile` prop with. */
interface FileRefTarget {
  path: string;
  line?: number;
}

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  onOpenFile: (ref: FileRefTarget) => void;
  onGoToBlast: () => void;
}

export function OverviewTab({ prId, prBody, onOpenFile, onGoToBlast }: OverviewTabProps) {
  // Reuses the SAME `["brief", prId]` query PrBriefCard fetches (deduped by
  // TanStack Query) — no second fetch (m6) — to feed IntentCard's Risk Areas
  // accordion (AC-13) with `brief.risks`.
  const { data: brief } = usePrBrief(prId);

  return (
    <>
      <IntentCard prId={prId} risks={brief?.risks} onOpenFile={onOpenFile} />
      <section>
        <SectionLabel icon="FileText">PR Brief</SectionLabel>
        {prId && <PrBriefCard prId={prId} onOpenFile={onOpenFile} />}
      </section>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
      <BlastRadiusSection prId={prId} onGoToBlast={onGoToBlast} />
    </>
  );
}
