/**
 * gaps.test.ts — unit tests for detectGaps (AC-13)
 *
 * Oracle: AC-13 observable — "a zero-gap repo omits First tasks with an honest
 * note; no invented task". Here we test the detection side:
 *   - A top-ranked source file with no sibling test file → missing_test gap detected.
 *   - A fully-covered fixture (all top-ranked files have tests) → [] returned.
 */

import { describe, it, expect } from 'vitest';
import { detectGaps } from './gaps.js';
import type { GapDetectionInputs, RankedFile } from './gaps.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInputs(overrides: Partial<GapDetectionInputs>): GapDetectionInputs {
  return {
    topRankedFiles: [],
    fileExists: () => false,
    docCoverage: {},
    conventionViolations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-13: detects genuine missing-test gap
// ---------------------------------------------------------------------------

describe('detectGaps — AC-13: genuine missing-test gap detection', () => {
  it('returns a missing_test gap for a top-ranked source file with no test file', () => {
    // Genuine detection: the service confirmed that none of the candidate test
    // paths exist in the clone (fileExists returns false for all candidates).
    const inputs = makeInputs({
      topRankedFiles: [{ path: 'src/modules/auth/service.ts', rank: 0.95 }],
      fileExists: () => false, // no test file exists
    });

    const gaps = detectGaps(inputs);

    expect(gaps.length).toBeGreaterThan(0);
    const missingTest = gaps.find((g) => g.gapType === 'missing_test');
    expect(missingTest).toBeDefined();
    expect(missingTest?.path).toBe('src/modules/auth/service.ts');
    expect(missingTest?.patternPointer).toBeTruthy();
    expect(missingTest?.evidence).toContain('src/modules/auth/service.ts');
  });

  it('does NOT flag a source file when a sibling .test.ts exists', () => {
    const inputs = makeInputs({
      topRankedFiles: [{ path: 'src/service.ts', rank: 0.9 }],
      // Simulates the service confirming the test file exists
      fileExists: (p) => p.includes('service.test.ts'),
    });

    const gaps = detectGaps(inputs);
    const missingTests = gaps.filter((g) => g.gapType === 'missing_test');
    expect(missingTests).toHaveLength(0);
  });

  it('does NOT flag a source file when a __tests__ directory entry exists', () => {
    const inputs = makeInputs({
      topRankedFiles: [{ path: 'src/helpers.ts', rank: 0.8 }],
      fileExists: (p) => p.includes('__tests__/helpers'),
    });

    const gaps = detectGaps(inputs);
    const missingTests = gaps.filter((g) => g.gapType === 'missing_test');
    expect(missingTests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-13: fully-covered fixture → []
// ---------------------------------------------------------------------------

describe('detectGaps — AC-13: fully-covered fixture returns []', () => {
  it('returns [] when all top-ranked files have test files', () => {
    // Observable: a zero-gap (fully-covered) repo returns an empty gap list.
    const inputs = makeInputs({
      topRankedFiles: [
        { path: 'src/service.ts', rank: 0.95 },
        { path: 'src/utils.ts',   rank: 0.80 },
        { path: 'src/helpers.ts', rank: 0.70 },
      ],
      // Every candidate test path exists
      fileExists: () => true,
      docCoverage: {
        'src/service.ts': true,
        'src/utils.ts':   true,
        'src/helpers.ts': true,
      },
      conventionViolations: [],
    });

    const gaps = detectGaps(inputs);
    expect(gaps).toHaveLength(0);
  });

  it('returns [] for empty topRankedFiles list', () => {
    const gaps = detectGaps(makeInputs({}));
    expect(gaps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional heuristics: missing_doc and missing_convention
// ---------------------------------------------------------------------------

describe('detectGaps — other heuristics', () => {
  it('detects a missing_doc gap when docCoverage[path] === false', () => {
    const inputs = makeInputs({
      topRankedFiles: [{ path: 'src/api.ts', rank: 0.9 }],
      fileExists: () => true, // has a test file
      docCoverage: { 'src/api.ts': false },
    });

    const gaps = detectGaps(inputs);
    const docGap = gaps.find((g) => g.gapType === 'missing_doc');
    expect(docGap).toBeDefined();
    expect(docGap?.path).toBe('src/api.ts');
  });

  it('does NOT detect a missing_doc gap when docCoverage[path] === true', () => {
    const inputs = makeInputs({
      topRankedFiles: [{ path: 'src/api.ts', rank: 0.9 }],
      fileExists: () => true,
      docCoverage: { 'src/api.ts': true },
    });

    const gaps = detectGaps(inputs);
    const docGap = gaps.find((g) => g.gapType === 'missing_doc');
    expect(docGap).toBeUndefined();
  });

  it('converts convention violations into missing_convention gaps', () => {
    const inputs = makeInputs({
      conventionViolations: [
        {
          filePath: 'src/handlers/auth.ts',
          conventionRule: 'handlers must use async/await',
          patternPointer: 'convention #5 — see the Conventions tab',
        },
      ],
    });

    const gaps = detectGaps(inputs);
    const convGap = gaps.find((g) => g.gapType === 'missing_convention');
    expect(convGap).toBeDefined();
    expect(convGap?.path).toBe('src/handlers/auth.ts');
  });

  it('does NOT flag test files or spec files themselves as needing a test', () => {
    const inputs = makeInputs({
      topRankedFiles: [
        { path: 'src/service.test.ts', rank: 0.9 },
        { path: 'src/service.spec.ts', rank: 0.8 },
        { path: 'src/__tests__/util.ts', rank: 0.7 },
      ],
      fileExists: () => false,
    });

    const gaps = detectGaps(inputs);
    expect(gaps).toHaveLength(0);
  });

  it('does NOT flag non-source assets (.json, .md) for missing tests', () => {
    const inputs = makeInputs({
      topRankedFiles: [
        { path: 'package.json', rank: 0.9 },
        { path: 'README.md', rank: 0.8 },
        { path: 'tsconfig.json', rank: 0.7 },
      ],
      fileExists: () => false,
    });

    const gaps = detectGaps(inputs);
    // Non-source files should not trigger missing_test
    const missingTests = gaps.filter((g) => g.gapType === 'missing_test');
    expect(missingTests).toHaveLength(0);
  });

  it('returns gaps in order: missing_test → missing_doc → missing_convention', () => {
    const inputs = makeInputs({
      topRankedFiles: [
        { path: 'src/service.ts', rank: 0.95 },
      ],
      fileExists: () => false,           // missing test
      docCoverage: { 'src/service.ts': false }, // missing doc too
      conventionViolations: [
        {
          filePath: 'src/controller.ts',
          conventionRule: 'must use dependency injection',
          patternPointer: 'convention #3',
        },
      ],
    });

    const gaps = detectGaps(inputs);
    expect(gaps.length).toBeGreaterThanOrEqual(3);

    // Order: missing_test comes before missing_doc before missing_convention
    const types = gaps.map((g) => g.gapType);
    const testIdx = types.indexOf('missing_test');
    const docIdx = types.indexOf('missing_doc');
    const convIdx = types.indexOf('missing_convention');

    expect(testIdx).toBeLessThan(docIdx);
    expect(docIdx).toBeLessThan(convIdx);
  });
});
