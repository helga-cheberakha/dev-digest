"use client";

import React, { useCallback } from "react";
import { SectionLabel } from "@devdigest/ui";
import PrBriefCard from "../PrBriefCard";
import { IntentCard } from "@/components/IntentCard";
import { BlastRadiusSection } from "./BlastRadiusSection";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  onWhy: (file: string, line: number) => void;
  onGoToBlast: () => void;
}

export function OverviewTab({ prId, prBody, onWhy, onGoToBlast }: OverviewTabProps) {
  const handleWhy = useCallback(
    (file: string, line: number) => {
      onWhy(file, line);
    },
    [onWhy],
  );

  return (
    <>
      <IntentCard prId={prId} />
      <section>
        <SectionLabel icon="FileText">PR Brief</SectionLabel>
        {prId && <PrBriefCard prId={prId} onWhy={handleWhy} />}
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
