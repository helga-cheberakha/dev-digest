/**
 * Deterministic scorer for the eval pipeline (L06).
 *
 * Pure functions only — NO DB, NO reviewer-core, NO LLM imports of any kind.
 * Safe to import in any Node process with zero env vars set.
 */
import type { EvalRegion } from '../../vendor/shared/contracts/eval-ci.js';
import type { EvalRun, EvalPerTrace } from '../../vendor/shared/contracts/knowledge.js';

// ---------------------------------------------------------------------------
// Region intersection
// ---------------------------------------------------------------------------

/**
 * Returns true when regions a and b are in the same file AND their inclusive
 * [start_line, end_line] ranges overlap.
 */
export function regionsIntersect(a: EvalRegion, b: EvalRegion): boolean {
  return (
    a.file === b.file &&
    a.start_line <= b.end_line &&
    b.start_line <= a.end_line
  );
}

// ---------------------------------------------------------------------------
// Per-case scoring
// ---------------------------------------------------------------------------

export interface ScoreCaseParams {
  expectation: 'must_find' | 'must_not_flag';
  expectedRegions: EvalRegion[];
  actualRegions: EvalRegion[];
}

/** Contribution values used by pooled aggregation. */
export interface CaseScore {
  /** Whether the case passed (all expected found / no forbidden raised). */
  pass: boolean;
  /** Number of must_find expected regions matched by at least one actual.
   *  Zero for must_not_flag cases. */
  matchedExpected: number;
  /** Total must_find expected regions (recall denominator contribution).
   *  Zero for must_not_flag cases. */
  totalExpected: number;
  /** Number of actual findings that are NOT noise (precision numerator). */
  nonNoiseActuals: number;
  /** Total actual findings (precision denominator). */
  totalActuals: number;
}

/**
 * Scores a single eval case.
 *
 * Noise rule (confirmed design decision, not a bug):
 * - In a must_find case, an actual finding that matches NO expected region is noise.
 * - In a must_not_flag case, an actual finding that matches a forbidden region is noise.
 */
export function scoreCase(params: ScoreCaseParams): CaseScore {
  const { expectation, expectedRegions, actualRegions } = params;
  const totalActuals = actualRegions.length;

  if (expectation === 'must_find') {
    // An expected region is matched if at least one actual region intersects it.
    const matchedExpected = expectedRegions.filter((exp) =>
      actualRegions.some((act) => regionsIntersect(exp, act)),
    ).length;

    // An actual is non-noise if it intersects at least one expected region.
    // Extra actuals that match nothing are noise (deliberate decision).
    const nonNoiseActuals = actualRegions.filter((act) =>
      expectedRegions.some((exp) => regionsIntersect(exp, act)),
    ).length;

    return {
      pass: matchedExpected === expectedRegions.length,
      matchedExpected,
      totalExpected: expectedRegions.length,
      nonNoiseActuals,
      totalActuals,
    };
  } else {
    // must_not_flag: a forbidden region being raised by the agent is noise.
    const noiseActuals = actualRegions.filter((act) =>
      expectedRegions.some((exp) => regionsIntersect(exp, act)),
    ).length;

    return {
      pass: noiseActuals === 0,
      matchedExpected: 0,  // must_not_flag cases contribute 0 to recall
      totalExpected: 0,    // must_not_flag cases contribute 0 to recall denominator
      nonNoiseActuals: totalActuals - noiseActuals,
      totalActuals,
    };
  }
}

// ---------------------------------------------------------------------------
// Pooled aggregation across a case set
// ---------------------------------------------------------------------------

export interface AggregateCase {
  /** Label used in per_trace.name. */
  name: string;
  /** Scored result from scoreCase(). */
  score: CaseScore;
  /** Passed through to per_trace.expected (for traceability). */
  expected: EvalRegion[];
  /** Passed through to per_trace.actual (for traceability). */
  actual: EvalRegion[];
}

export interface GroundingStats {
  /** Findings that passed the grounding gate. */
  kept: number;
  /** Findings produced by the agent before grounding. */
  produced: number;
}

/**
 * Pools contributions across all cases and returns a complete EvalRun.
 *
 * Aggregation is pooled (sum numerators / sum denominators across the whole
 * set), NOT a mean of per-case ratios. This is an explicit design decision.
 *
 * - recall = sum(matchedExpected) / sum(totalExpected);
 *   1 when there are no must_find cases.
 * - precision = sum(nonNoiseActuals) / sum(totalActuals);
 *   1 when the agent produced zero findings.
 * - citation_accuracy = kept / produced; 1 when produced = 0.
 */
export function aggregate(
  cases: AggregateCase[],
  grounding: GroundingStats,
  opts?: { durationMs?: number; costUsd?: number | null },
): EvalRun {
  // --- recall (pooled) ---
  const totalMatchedExpected = cases.reduce((s, c) => s + c.score.matchedExpected, 0);
  const totalExpected = cases.reduce((s, c) => s + c.score.totalExpected, 0);
  const recall = totalExpected === 0 ? 1 : totalMatchedExpected / totalExpected;

  // --- precision (pooled) ---
  const totalNonNoise = cases.reduce((s, c) => s + c.score.nonNoiseActuals, 0);
  const totalActuals = cases.reduce((s, c) => s + c.score.totalActuals, 0);
  const precision = totalActuals === 0 ? 1 : totalNonNoise / totalActuals;

  // --- citation accuracy ---
  const citation_accuracy =
    grounding.produced === 0 ? 1 : grounding.kept / grounding.produced;

  // --- per_trace ---
  const per_trace: EvalPerTrace[] = cases.map((c) => ({
    name: c.name,
    pass: c.score.pass,
    expected: c.expected,
    actual: c.actual,
  }));

  return {
    recall,
    precision,
    citation_accuracy,
    traces_passed: cases.filter((c) => c.score.pass).length,
    traces_total: cases.length,
    duration_ms: opts?.durationMs ?? 0,
    cost_usd: opts?.costUsd ?? null,
    per_trace,
  };
}
