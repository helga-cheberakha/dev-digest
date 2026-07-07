/**
 * readingPath.test.ts — unit tests for buildReadingPath (AC-4, AC-5)
 *
 * Oracle:
 *   AC-4 — "with hotness varied on top-N candidates, reading order differs
 *           from pure-pagerank order"
 *   AC-5 — "a repo with no git history still returns an ordered reading path"
 */

import { describe, it, expect } from 'vitest';
import { buildReadingPath } from './readingPath.js';
import type { ReadingPathRankRow } from './readingPath.js';

// ---------------------------------------------------------------------------
// Helper: build a simple link for testing
// ---------------------------------------------------------------------------

const buildLink = (path: string) => `https://github.com/owner/repo/blob/abc/${path}`;

// ---------------------------------------------------------------------------
// AC-4: varied hotness reorders vs pure-pagerank order
// ---------------------------------------------------------------------------

describe('buildReadingPath — AC-4: hotness reorders vs pure pagerank', () => {
  it('hotness influences order so that a lower-pagerank file with high hotness ranks above a higher-pagerank file with zero hotness', () => {
    // Pure-pagerank order: fileA (100) > fileB (80) > fileC (60)
    // With hotness: fileC has hotness 1.0 → combined = 60 × (1+1) = 120
    //              fileA has hotness 0   → combined = 100 × 1     = 100
    //              fileB has hotness 0   → combined = 80 × 1      = 80
    // Expected hotness-influenced order: fileC (120), fileA (100), fileB (80)
    const rows: ReadingPathRankRow[] = [
      { path: 'src/fileA.ts', percentile: 100 },
      { path: 'src/fileB.ts', percentile: 80 },
      { path: 'src/fileC.ts', percentile: 60 },
    ];
    const hotness = new Map([
      ['src/fileA.ts', 0],
      ['src/fileB.ts', 0],
      ['src/fileC.ts', 1.0],
    ]);

    const path = buildReadingPath(rows, hotness, buildLink);

    // Result is non-empty
    expect(path.length).toBeGreaterThan(0);

    const orderedPaths = path.map((e) => e.file);

    // Hotness-influenced order differs from pure-pagerank order
    // Pure pagerank: ['src/fileA.ts', 'src/fileB.ts', 'src/fileC.ts']
    // Hotness order: starts with fileC (highest combined rank)
    expect(orderedPaths[0]).toBe('src/fileC.ts');
    expect(orderedPaths[1]).toBe('src/fileA.ts');
    expect(orderedPaths[2]).toBe('src/fileB.ts');

    // Confirm this differs from pure-pagerank order
    const purePageRankOrder = ['src/fileA.ts', 'src/fileB.ts', 'src/fileC.ts'];
    expect(orderedPaths).not.toEqual(purePageRankOrder);
  });

  it('when all hotness values are equal, order matches pure pagerank (descending percentile)', () => {
    const rows: ReadingPathRankRow[] = [
      { path: 'a.ts', percentile: 90 },
      { path: 'b.ts', percentile: 60 },
      { path: 'c.ts', percentile: 30 },
    ];
    // Uniform hotness = 0 for all: combined = percentile × 1
    const hotness = new Map<string, number>();

    const result = buildReadingPath(rows, hotness, buildLink);
    const files = result.map((e) => e.file);
    expect(files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('each entry has file, rationale, and link fields populated', () => {
    const rows: ReadingPathRankRow[] = [{ path: 'src/core.ts', percentile: 85 }];
    const hotness = new Map([['src/core.ts', 0.2]]);

    const result = buildReadingPath(rows, hotness, buildLink);
    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe('src/core.ts');
    expect(result[0]?.rationale).toBeTruthy();
    expect(result[0]?.link).toBe(buildLink('src/core.ts'));
  });
});

// ---------------------------------------------------------------------------
// AC-5: no git history → hotness 0, path still ordered
// ---------------------------------------------------------------------------

describe('buildReadingPath — AC-5: no git history still returns ordered path', () => {
  it('returns an ordered reading path when all hotness values are 0 (no history)', () => {
    // Observable: a repo with no git history (hotness = 0 for all) still
    // returns a rank-ordered reading path (by pagerank).
    const rows: ReadingPathRankRow[] = [
      { path: 'src/service.ts', percentile: 95 },
      { path: 'src/helpers.ts', percentile: 70 },
      { path: 'src/utils.ts',   percentile: 45 },
    ];
    // All zero hotness (no history available)
    const hotness = new Map<string, number>();

    const result = buildReadingPath(rows, hotness, buildLink);

    // Still returns a non-empty, ordered path
    expect(result.length).toBeGreaterThan(0);

    const files = result.map((e) => e.file);
    expect(files[0]).toBe('src/service.ts'); // highest pagerank first
    expect(files[1]).toBe('src/helpers.ts');
    expect(files[2]).toBe('src/utils.ts');
  });

  it('returns empty array for empty rankRows input (valid degraded case)', () => {
    const result = buildReadingPath([], new Map(), buildLink);
    expect(result).toEqual([]);
  });

  it('caps output at 5 entries even when more than 5 candidates are given', () => {
    const rows: ReadingPathRankRow[] = Array.from({ length: 10 }, (_, i) => ({
      path: `src/file${i}.ts`,
      percentile: 100 - i * 5,
    }));
    const hotness = new Map<string, number>();

    const result = buildReadingPath(rows, hotness, buildLink);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('paths absent from the hotness map are treated as hotness 0', () => {
    // Paths not in the hotness map should still appear (treated as 0)
    const rows: ReadingPathRankRow[] = [
      { path: 'src/a.ts', percentile: 80 },
      { path: 'src/b.ts', percentile: 60 },
    ];
    // Only one path in the hotness map
    const hotness = new Map([['src/a.ts', 0]]);

    const result = buildReadingPath(rows, hotness, buildLink);
    const files = result.map((e) => e.file);
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.ts');
  });
});
