/**
 * hotness.test.ts — unit tests for computeHotness (AC-5)
 *
 * Oracle: AC-5 observable — "a repo with no git history still returns an
 * ordered reading path" and the 90-day window excludes stale commits.
 *
 * This file covers: no-history → hotness 0; 90-day windowing fixture that
 * confirms stale commits are excluded from the score.
 */

import { describe, it, expect } from 'vitest';
import { computeHotness } from './hotness.js';
import type { GitCommit } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a GitCommit stub at a given Date. */
function makeCommit(date: Date): GitCommit {
  return {
    sha: 'abc123',
    message: 'chore: update',
    author: 'dev',
    date: date.toISOString(),
  };
}

/** Date N days in the past from now. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// AC-5: no git history → hotness 0, path still ordered
// ---------------------------------------------------------------------------

describe('computeHotness — AC-5', () => {
  it('returns hotness 0 for a path with an empty commit list', () => {
    // Observable: no history → hotness = 0
    const result = computeHotness(new Map([['src/index.ts', []]]));
    expect(result.get('src/index.ts')).toBe(0);
  });

  it('returns an empty map for an empty input (no paths supplied)', () => {
    const result = computeHotness(new Map());
    expect(result.size).toBe(0);
  });

  it('returns hotness 0 for all paths when every commit is older than 90 days (windowing fixture)', () => {
    // AC-5: 90-day window — stale commits outside the window must be excluded.
    const staleCommit = makeCommit(daysAgo(100)); // 100 days ago → excluded
    const result = computeHotness(
      new Map([
        ['src/service.ts', [staleCommit, staleCommit]],
        ['src/helpers.ts', [staleCommit]],
      ]),
    );
    // Both paths had only stale commits; window filter drops them → all 0
    expect(result.get('src/service.ts')).toBe(0);
    expect(result.get('src/helpers.ts')).toBe(0);
  });

  it('counts only commits within the 90-day window, ignoring stale ones', () => {
    // Windowing fixture: one path has recent commits, the other has only stale commits.
    const recentCommit = makeCommit(daysAgo(5));   // inside window
    const staleCommit = makeCommit(daysAgo(100));   // outside window

    const result = computeHotness(
      new Map([
        ['src/active.ts', [recentCommit, recentCommit, recentCommit]],
        ['src/stale.ts',  [staleCommit, staleCommit]],
      ]),
    );

    // active.ts is the most active; it gets score 1.0
    expect(result.get('src/active.ts')).toBe(1);
    // stale.ts had no in-window commits; it gets 0 despite raw commit count
    expect(result.get('src/stale.ts')).toBe(0);
  });

  it('normalizes: most-active file gets 1.0, others scaled proportionally', () => {
    const recent = makeCommit(daysAgo(1));
    const result = computeHotness(
      new Map([
        ['a.ts', [recent, recent, recent, recent, recent]], // 5 commits → 1.0
        ['b.ts', [recent, recent, recent]],                 // 3 commits → 3/5
        ['c.ts', [recent]],                                 // 1 commit  → 1/5
      ]),
    );
    expect(result.get('a.ts')).toBe(1);
    expect(result.get('b.ts')).toBeCloseTo(3 / 5, 5);
    expect(result.get('c.ts')).toBeCloseTo(1 / 5, 5);
  });

  it('all hotness scores are 0 when every path has an empty history', () => {
    // AC-5: no-history case — hotness = 0, reading path still ordered by pagerank
    const result = computeHotness(
      new Map([
        ['src/a.ts', []],
        ['src/b.ts', []],
        ['src/c.ts', []],
      ]),
    );
    expect(result.get('src/a.ts')).toBe(0);
    expect(result.get('src/b.ts')).toBe(0);
    expect(result.get('src/c.ts')).toBe(0);
  });

  it('handles a mix of in-window and out-of-window commits correctly', () => {
    const recent = makeCommit(daysAgo(30));  // 30 days — inside
    const stale  = makeCommit(daysAgo(95));  // 95 days — outside

    const result = computeHotness(
      new Map([['src/mixed.ts', [recent, stale, recent]]]),
    );
    // Only 2 recent commits count; stale one ignored → score = 2/2 = 1
    // (it's the only file so it gets 1.0)
    expect(result.get('src/mixed.ts')).toBe(1);
  });

  it('respects a custom windowDays parameter', () => {
    // 30-day window instead of the default 90
    const recent = makeCommit(daysAgo(20)); // inside a 30-day window
    const stale  = makeCommit(daysAgo(60)); // outside a 30-day window

    const result = computeHotness(
      new Map([
        ['src/active.ts', [recent]],
        ['src/old.ts',    [stale]],
      ]),
      30,
    );
    expect(result.get('src/active.ts')).toBe(1);
    expect(result.get('src/old.ts')).toBe(0);
  });
});
