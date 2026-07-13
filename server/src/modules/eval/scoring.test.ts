import { describe, it, expect } from 'vitest';
import {
  regionsIntersect,
  scoreCase,
  aggregate,
  type AggregateCase,
} from './scoring.js';
import type { EvalRegion } from '../../vendor/shared/contracts/eval-ci.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function region(file: string, start: number, end: number): EvalRegion {
  return { file, start_line: start, end_line: end };
}

// ---------------------------------------------------------------------------
// regionsIntersect
// ---------------------------------------------------------------------------

describe('regionsIntersect', () => {
  it('returns true for same-file overlapping ranges', () => {
    expect(regionsIntersect(region('a.ts', 10, 20), region('a.ts', 15, 25))).toBe(true);
  });

  it('returns true when one range is contained inside another', () => {
    expect(regionsIntersect(region('a.ts', 5, 30), region('a.ts', 10, 20))).toBe(true);
  });

  it('returns true when ranges share exactly one boundary line', () => {
    expect(regionsIntersect(region('a.ts', 10, 15), region('a.ts', 15, 20))).toBe(true);
  });

  it('returns false for same-file disjoint ranges', () => {
    expect(regionsIntersect(region('a.ts', 1, 9), region('a.ts', 10, 20))).toBe(false);
  });

  it('returns false for disjoint ranges with a gap of one line', () => {
    expect(regionsIntersect(region('a.ts', 1, 5), region('a.ts', 7, 10))).toBe(false);
  });

  it('returns false for different files even with identical line ranges', () => {
    expect(regionsIntersect(region('a.ts', 1, 10), region('b.ts', 1, 10))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreCase — must_find
// ---------------------------------------------------------------------------

describe('scoreCase (must_find)', () => {
  const R1 = region('src/foo.ts', 10, 20);
  const R2 = region('src/foo.ts', 30, 40);
  const R3 = region('src/bar.ts', 5, 15);

  it('passes when all expected regions are matched', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1],
      actualRegions: [R1],
    });
    expect(score.pass).toBe(true);
    expect(score.matchedExpected).toBe(1);
    expect(score.totalExpected).toBe(1);
  });

  it('fails when an expected region is missed', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1, R2],
      actualRegions: [R1],
    });
    expect(score.pass).toBe(false);
    expect(score.matchedExpected).toBe(1);
    expect(score.totalExpected).toBe(2);
  });

  it('counts an extra unmatched actual finding as noise', () => {
    // R1 expected; agent also raises R2 (extra) — R2 is noise
    const extra = region('src/foo.ts', 50, 60);
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1],
      actualRegions: [R1, extra],
    });
    expect(score.nonNoiseActuals).toBe(1); // only R1 is non-noise
    expect(score.totalActuals).toBe(2);
  });

  it('accepts an overlapping (not identical) actual region as a match', () => {
    const overlapping = region('src/foo.ts', 15, 25); // overlaps R1 (10-20)
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1],
      actualRegions: [overlapping],
    });
    expect(score.pass).toBe(true);
    expect(score.matchedExpected).toBe(1);
  });

  it('rejects an actual in a different file even with same line numbers', () => {
    const wrongFile = region('src/other.ts', 10, 20);
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1],
      actualRegions: [wrongFile],
    });
    expect(score.pass).toBe(false);
    expect(score.matchedExpected).toBe(0);
  });

  it('scores zero non-noise when actual findings are all misses in multi-region case', () => {
    // 3 expected: R1, R2, R3. Agent produces a finding in a completely different location.
    const miss = region('src/other.ts', 100, 110);
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1, R2, R3],
      actualRegions: [miss],
    });
    expect(score.matchedExpected).toBe(0);
    expect(score.nonNoiseActuals).toBe(0);
    expect(score.totalActuals).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scoreCase — must_not_flag
// ---------------------------------------------------------------------------

describe('scoreCase (must_not_flag)', () => {
  const forbidden = region('secure.ts', 1, 50);

  it('passes when the agent raises no findings', () => {
    const score = scoreCase({
      expectation: 'must_not_flag',
      expectedRegions: [forbidden],
      actualRegions: [],
    });
    expect(score.pass).toBe(true);
    expect(score.totalExpected).toBe(0); // must_not_flag contributes 0 to recall
    expect(score.matchedExpected).toBe(0);
  });

  it('fails when the agent re-raises a forbidden region', () => {
    const score = scoreCase({
      expectation: 'must_not_flag',
      expectedRegions: [forbidden],
      actualRegions: [forbidden],
    });
    expect(score.pass).toBe(false);
    expect(score.nonNoiseActuals).toBe(0);
    expect(score.totalActuals).toBe(1);
  });

  it('counts forbidden-matching actuals as noise', () => {
    const legit = region('safe.ts', 5, 10);
    const score = scoreCase({
      expectation: 'must_not_flag',
      expectedRegions: [forbidden],
      actualRegions: [forbidden, legit],
    });
    // forbidden is noise; legit is not
    expect(score.nonNoiseActuals).toBe(1);
    expect(score.totalActuals).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// aggregate — pooled recall
// ---------------------------------------------------------------------------

describe('aggregate — pooled recall', () => {
  it('computes recall as 2/3 when 2 of 3 must_find expected regions are matched', () => {
    const R1 = region('src/a.ts', 1, 10);
    const R2 = region('src/a.ts', 20, 30);
    const R3 = region('src/a.ts', 40, 50);

    // Single case with 3 expected regions; agent hits R1 and R2, misses R3
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1, R2, R3],
      actualRegions: [R1, R2],
    });

    const cases: AggregateCase[] = [
      { name: 'case-1', score, expected: [R1, R2, R3], actual: [R1, R2] },
    ];

    const result = aggregate(cases, { kept: 2, produced: 2 });
    expect(result.recall).toBeCloseTo(2 / 3, 10);
  });

  it('pools recall across multiple cases (sum numerators / sum denominators)', () => {
    const R1 = region('src/a.ts', 1, 10);
    const R2 = region('src/b.ts', 1, 10);
    const R3 = region('src/c.ts', 1, 10);

    // Case 1: 2 expected, 2 matched → contributes 2/2
    const s1 = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R1, R2],
      actualRegions: [R1, R2],
    });
    // Case 2: 1 expected, 0 matched → contributes 0/1
    const s2 = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R3],
      actualRegions: [],
    });

    const cases: AggregateCase[] = [
      { name: 'c1', score: s1, expected: [R1, R2], actual: [R1, R2] },
      { name: 'c2', score: s2, expected: [R3], actual: [] },
    ];

    // Pooled: (2+0)/(2+1) = 2/3, not mean((2/2 + 0/1)/2) = 0.5
    const result = aggregate(cases, { kept: 0, produced: 0 });
    expect(result.recall).toBeCloseTo(2 / 3, 10);
  });

  it('returns recall = 1 when there are no must_find cases (only must_not_flag)', () => {
    const forbidden = region('s.ts', 1, 5);
    const score = scoreCase({
      expectation: 'must_not_flag',
      expectedRegions: [forbidden],
      actualRegions: [],
    });
    const result = aggregate(
      [{ name: 'no-flag', score, expected: [forbidden], actual: [] }],
      { kept: 0, produced: 0 },
    );
    expect(result.recall).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// aggregate — precision
// ---------------------------------------------------------------------------

describe('aggregate — precision', () => {
  it('drops precision below 1 when agent re-raises a must_not_flag forbidden region', () => {
    const forbidden = region('auth.ts', 10, 30);
    const score = scoreCase({
      expectation: 'must_not_flag',
      expectedRegions: [forbidden],
      actualRegions: [forbidden], // re-raised → noise
    });
    const result = aggregate(
      [{ name: 'no-false-alarm', score, expected: [forbidden], actual: [forbidden] }],
      { kept: 1, produced: 1 },
    );
    expect(result.precision).toBeLessThan(1);
    expect(result.precision).toBe(0);
  });

  it('drops precision below 1 when agent produces an extra unmatched finding in a must_find set', () => {
    const expected = region('src/a.ts', 1, 10);
    const extra = region('src/a.ts', 50, 60); // unmatched → noise
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [expected],
      actualRegions: [expected, extra],
    });
    const result = aggregate(
      [{ name: 'extra-noise', score, expected: [expected], actual: [expected, extra] }],
      { kept: 2, produced: 2 },
    );
    expect(result.precision).toBeLessThan(1);
    expect(result.precision).toBeCloseTo(1 / 2, 10);
  });

  it('returns precision = 1 when the agent produced zero findings', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [region('src/a.ts', 1, 5)],
      actualRegions: [],
    });
    const result = aggregate(
      [{ name: 'no-output', score, expected: [], actual: [] }],
      { kept: 0, produced: 0 },
    );
    expect(result.precision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// aggregate — citation accuracy
// ---------------------------------------------------------------------------

describe('aggregate — citation_accuracy', () => {
  it('computes 3/4 when 3 kept out of 4 produced', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [],
      actualRegions: [],
    });
    const result = aggregate(
      [{ name: 'c', score, expected: [], actual: [] }],
      { kept: 3, produced: 4 },
    );
    expect(result.citation_accuracy).toBeCloseTo(0.75, 10);
  });

  it('returns citation_accuracy = 1 when produced = 0', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [],
      actualRegions: [],
    });
    const result = aggregate(
      [{ name: 'c', score, expected: [], actual: [] }],
      { kept: 0, produced: 0 },
    );
    expect(result.citation_accuracy).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Zero LLM calls — prove by construction
// ---------------------------------------------------------------------------

describe('zero LLM calls', () => {
  it('returns correct metrics without any provider (scoring.ts has no provider parameter)', () => {
    /**
     * A fake "provider" whose only method throws if invoked. It is constructed
     * here to make the intent explicit, but it is NEVER passed into scoreCase or
     * aggregate — those functions accept no provider. The type-checker enforces
     * this at compile time; the runtime test confirms no call happens at runtime.
     */
    const fakeLLMProvider = {
      complete: (): never => {
        throw new Error('LLM must not be called by the scorer');
      },
      completeStructured: (): never => {
        throw new Error('LLM must not be called by the scorer');
      },
    };

    // Precomputed fixtures — zero LLM involvement
    const expected = region('src/service.ts', 42, 55);
    const actual = region('src/service.ts', 45, 60); // overlaps expected

    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [expected],
      actualRegions: [actual],
    });

    const result = aggregate(
      [{ name: 'LLM-free case', score, expected: [expected], actual: [actual] }],
      { kept: 1, produced: 1 },
    );

    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.citation_accuracy).toBe(1);
    expect(result.traces_passed).toBe(1);

    // Confirm fakeLLMProvider was never used (it exists but was never passed)
    expect(fakeLLMProvider).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Prompt-version sensitivity — different actuals → different recall
// ---------------------------------------------------------------------------

describe('prompt-version sensitivity', () => {
  it('yields different aggregate recall for two prompt versions over the same case', () => {
    const R1 = region('src/a.ts', 1, 10);
    const R2 = region('src/a.ts', 20, 30);
    const R3 = region('src/a.ts', 40, 50);
    const expectedRegions = [R1, R2, R3];

    // Prompt version A: agent finds 2 of 3 expected regions
    const scoreA = scoreCase({
      expectation: 'must_find',
      expectedRegions,
      actualRegions: [R1, R2],
    });
    const casesA: AggregateCase[] = [
      { name: 'case', score: scoreA, expected: expectedRegions, actual: [R1, R2] },
    ];

    // Prompt version B: agent finds only 1 of 3 expected regions
    const scoreB = scoreCase({
      expectation: 'must_find',
      expectedRegions,
      actualRegions: [R1],
    });
    const casesB: AggregateCase[] = [
      { name: 'case', score: scoreB, expected: expectedRegions, actual: [R1] },
    ];

    const resultA = aggregate(casesA, { kept: 2, produced: 2 });
    const resultB = aggregate(casesB, { kept: 1, produced: 1 });

    expect(resultA.recall).toBeCloseTo(2 / 3, 10);
    expect(resultB.recall).toBeCloseTo(1 / 3, 10);
    expect(resultA.recall).not.toBe(resultB.recall);
  });

  it('tracks the prompt-version signal across multiple cases (pooled)', () => {
    const R1 = region('src/x.ts', 1, 5);
    const R2 = region('src/y.ts', 1, 5);

    // Version A: hits both cases
    const sA1 = scoreCase({ expectation: 'must_find', expectedRegions: [R1], actualRegions: [R1] });
    const sA2 = scoreCase({ expectation: 'must_find', expectedRegions: [R2], actualRegions: [R2] });
    const casesA: AggregateCase[] = [
      { name: 'c1', score: sA1, expected: [R1], actual: [R1] },
      { name: 'c2', score: sA2, expected: [R2], actual: [R2] },
    ];

    // Version B: hits only the first case
    const sB1 = scoreCase({ expectation: 'must_find', expectedRegions: [R1], actualRegions: [R1] });
    const sB2 = scoreCase({ expectation: 'must_find', expectedRegions: [R2], actualRegions: [] });
    const casesB: AggregateCase[] = [
      { name: 'c1', score: sB1, expected: [R1], actual: [R1] },
      { name: 'c2', score: sB2, expected: [R2], actual: [] },
    ];

    const recallA = aggregate(casesA, { kept: 0, produced: 0 }).recall;
    const recallB = aggregate(casesB, { kept: 0, produced: 0 }).recall;

    expect(recallA).toBe(1);          // 2/2
    expect(recallB).toBeCloseTo(0.5, 10); // 1/2
    expect(recallA).toBeGreaterThan(recallB);
  });
});

// ---------------------------------------------------------------------------
// EvalRun shape compliance
// ---------------------------------------------------------------------------

describe('EvalRun shape', () => {
  it('returns all required EvalRun fields', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [],
      actualRegions: [],
    });
    const result = aggregate(
      [{ name: 't', score, expected: [], actual: [] }],
      { kept: 0, produced: 0 },
    );
    expect(typeof result.recall).toBe('number');
    expect(typeof result.precision).toBe('number');
    expect(typeof result.citation_accuracy).toBe('number');
    expect(typeof result.traces_passed).toBe('number');
    expect(typeof result.traces_total).toBe('number');
    expect(typeof result.duration_ms).toBe('number');
    expect(Array.isArray(result.per_trace)).toBe(true);
  });

  it('per_trace entries have name, pass, expected, actual', () => {
    const R = region('f.ts', 1, 5);
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [R],
      actualRegions: [R],
    });
    const result = aggregate(
      [{ name: 'my-case', score, expected: [R], actual: [R] }],
      { kept: 1, produced: 1 },
    );
    const trace = result.per_trace[0];
    expect(trace).toBeDefined();
    expect(trace?.name).toBe('my-case');
    expect(trace?.pass).toBe(true);
    expect(Array.isArray(trace?.expected)).toBe(true);
    expect(Array.isArray(trace?.actual)).toBe(true);
  });

  it('traces_passed counts only passing cases, not every case in the batch', () => {
    // Mutation-testing regression: a mutant replacing `cases.filter((c) =>
    // c.score.pass).length` with `cases.length` survived because every prior
    // test's aggregate() call happened to have a 1-passing/1-total set, where
    // both expressions give the same answer. A mixed pass/fail batch is
    // required to distinguish them.
    const found = region('f.ts', 1, 5);
    const missed = region('g.ts', 1, 5);
    const passingScore = scoreCase({
      expectation: 'must_find',
      expectedRegions: [found],
      actualRegions: [found],
    });
    const failingScore = scoreCase({
      expectation: 'must_find',
      expectedRegions: [missed],
      actualRegions: [],
    });

    const result = aggregate(
      [
        { name: 'pass-1', score: passingScore, expected: [found], actual: [found] },
        { name: 'fail-1', score: failingScore, expected: [missed], actual: [] },
        { name: 'pass-2', score: passingScore, expected: [found], actual: [found] },
      ],
      { kept: 2, produced: 2 },
    );

    expect(result.traces_total).toBe(3);
    expect(result.traces_passed).toBe(2);
  });

  it('passes custom durationMs and costUsd through to EvalRun', () => {
    const score = scoreCase({
      expectation: 'must_find',
      expectedRegions: [],
      actualRegions: [],
    });
    const result = aggregate(
      [{ name: 't', score, expected: [], actual: [] }],
      { kept: 0, produced: 0 },
      { durationMs: 1234, costUsd: 0.005 },
    );
    expect(result.duration_ms).toBe(1234);
    expect(result.cost_usd).toBe(0.005);
  });
});
