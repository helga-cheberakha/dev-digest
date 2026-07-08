import type { IconName } from "@devdigest/ui";
import type { Brief } from "@devdigest/shared";

/** `risk_level` -> banner token colours + icon (AC-10). Tokens are the design
 * system's semantic pair (`--crit`/`--warn`/`--ok` + matching `-bg`) — there is
 * no `--green`/`--red`/`--amber`. */
export const RISK_LEVEL_META: Record<Brief["risk_level"], { color: string; bg: string; icon: IconName }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};

/** Icons for the metrics row (AC-11: findings/blockers/score/cost/tokens). */
export const METRIC_ICONS = {
  findings: "ListChecks",
  blockers: "AlertOctagon",
  score: "Gauge",
  cost: "DollarSign",
  tokens: "Hash",
} satisfies Record<string, IconName>;

/** Max file refs rendered per Review Focus item before truncating. */
export const MAX_FILE_REFS = 6;
