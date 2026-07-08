/**
 * grounding.ts — Why+Risk Brief grounding gate.
 *
 * Pure / I/O-free mechanical check that runs on the raw LLM `Brief` output
 * before it is cached. This is a DISTINCT, path-set-only gate from
 * reviewer-core's `groundFindings()` (which needs diff hunks and line
 * ranges) — the Brief has no diff hunks available (AC-2), so grounding here
 * only ever checks "does this path exist in the known-path set", never
 * lines.
 *
 * Known-path set is built by `assembler.ts#buildKnownPathSet` (Blast union
 * Smart-Diff) and passed in — this file never computes it itself, keeping
 * the two pure modules independently testable.
 */

import type { Brief } from '@devdigest/shared';

export interface DroppedRef {
  ref: string;
  from: 'risks' | 'review_focus';
  reason: string;
}

export interface GroundBriefResult {
  brief: Brief;
  dropped: DroppedRef[];
}

/**
 * `file_refs` may carry a `:line` or `:line-range` suffix (e.g.
 * `src/foo.ts:42` or `src/foo.ts:42-58`). Grounding compares the PATH
 * portion only — strip the suffix before the set lookup.
 */
export function stripLineSuffix(fileRef: string): string {
  return fileRef.replace(/:\d+(?:-\d+)?$/, '');
}

/**
 * Apply the grounding gate to a raw `Brief`:
 *  - AC-4: drop any `file_ref` (in `risks[]` or `review_focus[]`) whose path
 *    portion is absent from `knownPaths`.
 *  - AC-5: after that, drop a `review_focus` item left with zero `file_ref`s;
 *    KEEP a `risks` item with empty `file_refs` (a risk can be valid without
 *    a specific file pointer).
 */
export function groundBrief(brief: Brief, knownPaths: ReadonlySet<string>): GroundBriefResult {
  const dropped: DroppedRef[] = [];

  const filterRefs = (refs: string[], from: DroppedRef['from']): string[] =>
    refs.filter((ref) => {
      const path = stripLineSuffix(ref);
      const ok = knownPaths.has(path);
      if (!ok) dropped.push({ ref, from, reason: `path '${path}' not in known-path set` });
      return ok;
    });

  const risks = brief.risks.map((risk) => ({
    ...risk,
    file_refs: filterRefs(risk.file_refs, 'risks'),
  }));

  const reviewFocus = brief.review_focus
    .map((item) => ({
      ...item,
      file_refs: filterRefs(item.file_refs, 'review_focus'),
    }))
    .filter((item) => item.file_refs.length > 0);

  return {
    brief: { ...brief, risks, review_focus: reviewFocus },
    dropped,
  };
}
