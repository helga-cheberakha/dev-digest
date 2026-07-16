/**
 * colors.ts — deterministic colour helpers for the Agent Performance dashboard.
 *
 * `segmentColor` maps any label string to a stable colour from a fixed palette
 * via a simple integer hash so the same agent/model name always gets the same
 * colour across renders and sessions.
 *
 * `withColors` lifts a `PerfCostSegment[]` (no color field) into the
 * `DonutSegment[]` shape that the vendor `Donut` chart expects.
 *
 * `NO_DATA_GLYPH` is the shared no-data placeholder used by both SummaryCards
 * and AgentPerfTable for null accept_rate and null cost values, keeping the
 * two surfaces visually consistent.
 */

import type { PerfCostSegment } from "@devdigest/shared";
import type { DonutSegment } from "@devdigest/ui";

/** Fixed palette: 10 colours with adequate contrast in the dark theme. */
const PALETTE: readonly string[] = [
  "#6366f1", // indigo
  "#22d3ee", // cyan
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f87171", // rose
  "#60a5fa", // sky
  "#fb923c", // orange
  "#a3e635", // lime
  "#e879f9", // fuchsia
];

/** djb2-style hash: same label → same non-negative integer every call. */
function hashLabel(label: string): number {
  let h = 5381;
  for (let i = 0; i < label.length; i++) {
    h = ((h << 5) + h + label.charCodeAt(i)) >>> 0; // keep in Uint32 range
  }
  return h;
}

/**
 * Return a stable, deterministic colour string for a segment label.
 * The same label always maps to the same colour within a session AND across
 * sessions because the hash is purely function of the label text.
 */
export function segmentColor(label: string): string {
  return PALETTE[hashLabel(label) % PALETTE.length]!;
}

/**
 * Map `PerfCostSegment[]` (label + value, no color) to `DonutSegment[]`
 * (label + value + color) using stable per-label colours.
 */
export function withColors(segments: PerfCostSegment[]): DonutSegment[] {
  return segments.map((s) => ({
    label: s.label,
    value: s.value,
    color: segmentColor(s.label),
  }));
}

/**
 * Shared no-data placeholder for null accept_rate and null cost.
 * Export from here so both SummaryCards and AgentPerfTable stay visually
 * consistent without duplicating the string.
 */
export const NO_DATA_GLYPH = "—" as const;
