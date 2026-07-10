"use client";

import React from "react";
import { Skeleton, ErrorState, SectionLabel, Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { usePrBlast } from "../../../../../../../lib/hooks/brief";
import { blastCounts } from "../BlastRadius/helpers";
import { STAT_ICONS } from "../BlastRadius/constants";
import { PriorPrsAccordion } from "./PriorPrsAccordion";
import { BlastGraphLightbox } from "./BlastGraphLightbox";

interface BlastRadiusSectionProps {
  prId: string | null;
  onGoToBlast: () => void;
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-elevated)",
  padding: 18,
};

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  lineHeight: 1.5,
};

export function BlastRadiusSection({ prId, onGoToBlast }: BlastRadiusSectionProps) {
  const t = useTranslations("blast");
  const { data: blast, isLoading, isError } = usePrBlast(prId);
  const [graphOpen, setGraphOpen] = React.useState(false);

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

  if (!blast) return null;

  const counts = blastCounts(blast);

  return (
    <section style={cardStyle}>
      <SectionLabel
        icon="Zap"
        right={
          <button onClick={() => setGraphOpen(true)} style={btnStyle}>
            {t("graphBtn")}
          </button>
        }
      >
        {t("graphTitle")}
      </SectionLabel>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "10px 0" }}>
        {STAT_ICONS.map((stat) => {
          const I = Icon[stat.icon];
          return (
            <span
              key={stat.key}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}
            >
              <I size={13} style={{ color: "var(--text-secondary)" }} />
              <b className="tnum">{counts[stat.key as keyof typeof counts]}</b>
              {t(`stat.${stat.key}`)}
            </span>
          );
        })}
      </div>
      <button onClick={() => onGoToBlast()} style={{ ...btnStyle, marginTop: 8 }}>
        {t("summary.goToTab")}
      </button>
      <PriorPrsAccordion priorPrs={blast.prior_prs ?? []} />
      {graphOpen && blast && (
        <BlastGraphLightbox blast={blast} onClose={() => setGraphOpen(false)} />
      )}
    </section>
  );
}
