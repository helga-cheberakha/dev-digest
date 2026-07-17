"use client";

/**
 * CategoryDonut — donut chart of cost attribution by finding category.
 *
 * Wraps the existing vendor `Donut` component (Recharts PieChart ring).
 * Uses `segmentColor` from the shared lib/colors module so the same
 * category label always maps to the same stable colour (djb2 hash → palette)
 * — the same approach used by CostBreakdown on the agent-performance dashboard.
 *
 * "use client" required: Donut wraps Recharts which uses browser APIs.
 *
 * Empty array → a plain empty-state message (not a blank or broken donut).
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Donut } from "@devdigest/ui";
import { segmentColor } from "@/lib/colors";

type CostByCategory = { category: string; cost_usd: number };

export function CategoryDonut({
  costByCategory,
}: {
  costByCategory: CostByCategory[];
}) {
  const t = useTranslations("agents");

  if (costByCategory.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
        {t("stats.category.emptyState")}
      </p>
    );
  }

  const segments = costByCategory.map((c) => ({
    label: c.category,
    value: c.cost_usd,
    color: segmentColor(c.category),
  }));

  return <Donut segments={segments} valuePrefix="$" />;
}
