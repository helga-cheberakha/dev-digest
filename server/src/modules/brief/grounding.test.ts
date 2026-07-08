import { describe, it, expect } from 'vitest';
import type { Brief } from '@devdigest/shared';
import { groundBrief, stripLineSuffix } from './grounding.js';

const KNOWN_PATHS = new Set(['src/webhooks/handler.ts', 'src/webhooks/routes.ts']);

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    what: 'Adds retry logic.',
    why: 'Reduce dropped webhook events.',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    ...overrides,
  };
}

describe('stripLineSuffix', () => {
  it('strips a single-line suffix', () => {
    expect(stripLineSuffix('src/foo.ts:42')).toBe('src/foo.ts');
  });

  it('strips a line-range suffix', () => {
    expect(stripLineSuffix('src/foo.ts:42-58')).toBe('src/foo.ts');
  });

  it('leaves a bare path untouched', () => {
    expect(stripLineSuffix('src/foo.ts')).toBe('src/foo.ts');
  });
});

describe('groundBrief', () => {
  it('AC-4: strips a hallucinated file_ref not present in the known-path set', () => {
    const brief = makeBrief({
      risks: [
        {
          kind: 'security',
          title: 'Possible replay',
          explanation: 'Retries could replay non-idempotent calls.',
          severity: 'high',
          file_refs: ['src/webhooks/handler.ts', 'src/imaginary/nonexistent.ts'],
        },
      ],
      review_focus: [
        {
          label: 'Check retry idempotency',
          file_refs: ['src/webhooks/routes.ts:10', 'src/does/not/exist.ts:1-5'],
        },
      ],
    });

    const { brief: grounded, dropped } = groundBrief(brief, KNOWN_PATHS);

    expect(grounded.risks[0]!.file_refs).toEqual(['src/webhooks/handler.ts']);
    expect(grounded.review_focus[0]!.file_refs).toEqual(['src/webhooks/routes.ts:10']);

    expect(dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'src/imaginary/nonexistent.ts', from: 'risks' }),
        expect.objectContaining({ ref: 'src/does/not/exist.ts:1-5', from: 'review_focus' }),
      ]),
    );
    expect(dropped).toHaveLength(2);
  });

  it('AC-5: a review_focus item emptied of all file_refs by grounding is dropped', () => {
    const brief = makeBrief({
      review_focus: [
        { label: 'Bogus focus', file_refs: ['src/nonexistent/a.ts'] },
        { label: 'Real focus', file_refs: ['src/webhooks/handler.ts'] },
      ],
    });

    const { brief: grounded } = groundBrief(brief, KNOWN_PATHS);

    expect(grounded.review_focus).toHaveLength(1);
    expect(grounded.review_focus[0]!.label).toBe('Real focus');
  });

  it('AC-5: a risks item that already has empty file_refs is kept (not dropped)', () => {
    const brief = makeBrief({
      risks: [
        {
          kind: 'performance',
          title: 'General perf concern',
          explanation: 'No specific file, but worth flagging.',
          severity: 'low',
          file_refs: [],
        },
      ],
    });

    const { brief: grounded, dropped } = groundBrief(brief, KNOWN_PATHS);

    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]!.file_refs).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it('AC-5: a risks item emptied of all refs by grounding is still kept (only review_focus is dropped for emptiness)', () => {
    const brief = makeBrief({
      risks: [
        {
          kind: 'data',
          title: 'Data risk',
          explanation: 'Refs all hallucinated.',
          severity: 'medium',
          file_refs: ['src/nope.ts'],
        },
      ],
    });

    const { brief: grounded } = groundBrief(brief, KNOWN_PATHS);

    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]!.file_refs).toEqual([]);
  });

  it('keeps all refs and reports zero drops when everything is grounded', () => {
    const brief = makeBrief({
      risks: [
        {
          kind: 'other',
          title: 'Fine',
          explanation: 'All good.',
          severity: 'low',
          file_refs: ['src/webhooks/handler.ts'],
        },
      ],
      review_focus: [{ label: 'Look here', file_refs: ['src/webhooks/routes.ts'] }],
    });

    const { brief: grounded, dropped } = groundBrief(brief, KNOWN_PATHS);

    expect(dropped).toEqual([]);
    expect(grounded.risks[0]!.file_refs).toEqual(['src/webhooks/handler.ts']);
    expect(grounded.review_focus[0]!.file_refs).toEqual(['src/webhooks/routes.ts']);
  });
});
