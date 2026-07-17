/**
 * Constants for the agent-performance module.
 */

/** Number of recent done-runs to use for the trend sparkline. */
export const TREND_RUN_COUNT = 10;

/** Maximum allowed range in days for a custom window query. */
export const MAX_RANGE_DAYS = 365;

/** Preset period identifiers. */
export type PresetPeriod = '30d' | '1d';

/** Default page size for the Run History endpoint. */
export const RUN_HISTORY_DEFAULT_LIMIT = 25;

/** Hard cap on page size for the Run History endpoint (AC-12). */
export const RUN_HISTORY_MAX_LIMIT = 100;

/**
 * Desired number of time buckets in the severity-over-time chart.
 * The bucketing helper uses this as a target (actual count may be lower
 * for narrow windows, e.g. the 1d preset).
 */
export const SEVERITY_BUCKET_TARGET = 7;
