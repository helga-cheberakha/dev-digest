"use client";

import React from "react";
import { Skeleton, ErrorState, Badge } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { usePrBlast } from "../../../../../../../lib/hooks/brief";
import { useRepoIntelStatus } from "../../../../../../../lib/hooks/repo-intel";
import { BlastRadiusView } from "../BlastRadius";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";

interface BlastTabProps {
  prId: string | null;
  repoId: string | null;
  repoFullName: string | null;
  headSha: string | null;
}

export function BlastTab({ prId, repoId, repoFullName, headSha }: BlastTabProps) {
  const t = useTranslations("blast");
  const { data: blast, isLoading, isError } = usePrBlast(prId);
  const { data: intelStatus } = useRepoIntelStatus(repoId);

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={24} width={300} />
        <Skeleton height={120} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState title={t("tab.error")} />;
  }

  return (
    <section>
      {intelStatus?.degraded === true && (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("tab.degraded")}
          </Badge>
          {intelStatus.degradedReason && (
            <Badge color="var(--warn)" bg="var(--warn-bg)">
              {t("tab.degradedReason", { reason: intelStatus.degradedReason })}
            </Badge>
          )}
        </div>
      )}
      {blast && (
        <BlastRadiusView
          blast={blast}
          onWhy={(file, line) => {
            if (!repoFullName || !headSha) return;
            window.open(
              githubBlobUrl(repoFullName, headSha, file, line),
              "_blank",
              "noopener,noreferrer",
            );
          }}
        />
      )}
    </section>
  );
}
