/**
 * Constants for the agent-performance module.
 */

/** Number of recent done-runs to use for the trend sparkline. */
export const TREND_RUN_COUNT = 10;

/** Maximum allowed range in days for a custom window query. */
export const MAX_RANGE_DAYS = 365;

/** Preset period identifiers. */
export type PresetPeriod = '30d' | '1d';
