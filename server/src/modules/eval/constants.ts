/**
 * Eval module constants.
 */

/**
 * Default review strategy used when an agent row has no explicit strategy set.
 * 'single-pass' = send the WHOLE diff in ONE LLM call.
 *
 * Kept here (not imported from reviews/) so the eval module has zero coupling
 * to the reviews module. The value must stay in sync with
 * reviews/constants.ts REVIEW_STRATEGY — both are 'single-pass'.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;
