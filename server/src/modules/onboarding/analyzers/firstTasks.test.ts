/**
 * firstTasks.test.ts — unit tests for buildFirstTasks (AC-13)
 *
 * Oracle: AC-13 observable — "a zero-gap repo omits First tasks with an honest
 * note; no invented task" (formatting + honest omission).
 */

import { describe, it, expect } from 'vitest';
import { buildFirstTasks } from './firstTasks.js';
import type { Gap } from './gaps.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMissingTestGap(path = 'src/service.ts'): Gap {
  return {
    gapType: 'missing_test',
    path,
    patternPointer: 'Add a sibling *.test.ts file co-located with this module.',
    evidence: `Top-ranked source file "${path}" has no sibling or __tests__ test file.`,
  };
}

function makeMissingDocGap(path = 'src/api.ts'): Gap {
  return {
    gapType: 'missing_doc',
    path,
    patternPointer: 'Add JSDoc/TSDoc block comments above every exported function.',
    evidence: `Top-ranked file "${path}" has exported symbols without JSDoc/TSDoc.`,
  };
}

// ---------------------------------------------------------------------------
// AC-13: empty gap list omits honestly
// ---------------------------------------------------------------------------

describe('buildFirstTasks — AC-13: honest omission on empty gap list', () => {
  it('returns kind:"omitted" with a non-empty reason when the gap list is empty', () => {
    // Observable: zero-gap repo → First tasks omitted with an honest note, not fabricated.
    const result = buildFirstTasks([]);

    expect(result.kind).toBe('omitted');
    // The reason must be a non-empty honest message, not a placeholder or fabricated task
    if (result.kind === 'omitted') {
      expect(result.reason.length).toBeGreaterThan(0);
      // Must not fabricate tasks
      expect(result).not.toHaveProperty('tasks');
    }
  });

  it('never returns tasks when the gap list is empty', () => {
    const result = buildFirstTasks([]);
    // Discriminate: if kind is 'omitted', there must be no tasks field
    expect(result.kind).toBe('omitted');
    if (result.kind === 'tasks') {
      // This branch must not be reached — fail explicitly
      throw new Error('Expected omitted but got tasks');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-13: non-empty gap list → well-formed tasks
// ---------------------------------------------------------------------------

describe('buildFirstTasks — AC-13: non-empty gap list yields well-formed tasks', () => {
  it('returns kind:"tasks" with well-formed FirstTaskEntry items for a non-empty gap list', () => {
    const gaps: Gap[] = [makeMissingTestGap(), makeMissingDocGap()];
    const result = buildFirstTasks(gaps);

    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      expect(result.tasks.length).toBeGreaterThan(0);
      for (const task of result.tasks) {
        expect(typeof task.title).toBe('string');
        expect(task.title.length).toBeGreaterThan(0);
        expect(typeof task.suggestedPath).toBe('string');
        expect(task.suggestedPath.length).toBeGreaterThan(0);
        expect(typeof task.gapType).toBe('string');
        expect(typeof task.rationale).toBe('string');
        expect(task.rationale.length).toBeGreaterThan(0);
        expect(typeof task.patternPointer).toBe('string');
        expect(task.patternPointer.length).toBeGreaterThan(0);
        expect(typeof task.complexity).toBe('string');
        expect(task.complexity.length).toBeGreaterThan(0);
      }
    }
  });

  it('maps the gap path to suggestedPath', () => {
    const gap = makeMissingTestGap('src/modules/auth/service.ts');
    const result = buildFirstTasks([gap]);

    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      expect(result.tasks[0]?.suggestedPath).toBe('src/modules/auth/service.ts');
    }
  });

  it('maps the gap evidence to rationale (grounded, not invented)', () => {
    const gap = makeMissingTestGap('src/core.ts');
    const result = buildFirstTasks([gap]);

    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      // Rationale should come from the gap evidence (which is factual and grounded)
      expect(result.tasks[0]?.rationale).toContain('src/core.ts');
    }
  });

  it('maps the gap patternPointer correctly', () => {
    const gap = makeMissingDocGap('src/api.ts');
    const result = buildFirstTasks([gap]);

    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      expect(result.tasks[0]?.patternPointer).toBe(gap.patternPointer);
    }
  });

  it('caps at 3 tasks when more than 3 gaps are provided', () => {
    const gaps: Gap[] = [
      makeMissingTestGap('src/a.ts'),
      makeMissingTestGap('src/b.ts'),
      makeMissingTestGap('src/c.ts'),
      makeMissingTestGap('src/d.ts'), // 4th — should be dropped
    ];

    const result = buildFirstTasks(gaps);

    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      expect(result.tasks.length).toBeLessThanOrEqual(3);
    }
  });

  it('assigns correct complexity based on gapType', () => {
    const testGap = makeMissingTestGap();
    const docGap = makeMissingDocGap();

    const testResult = buildFirstTasks([testGap]);
    const docResult  = buildFirstTasks([docGap]);

    expect(testResult.kind).toBe('tasks');
    expect(docResult.kind).toBe('tasks');

    if (testResult.kind === 'tasks') {
      expect(testResult.tasks[0]?.complexity).toBe('medium');
    }
    if (docResult.kind === 'tasks') {
      expect(docResult.tasks[0]?.complexity).toBe('low');
    }
  });

  it('gapType is preserved from the original gap', () => {
    const gap = makeMissingTestGap();
    const result = buildFirstTasks([gap]);

    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      expect(result.tasks[0]?.gapType).toBe('missing_test');
    }
  });
});
