import type { ReviewRecord, FindingRecord } from '@devdigest/shared';
import { compactFinding, detailedFinding } from '../format.js';

// ---- Review selection ----

/** Pick the best ReviewRecord for a PR.
 *  Prefers kind:'review' (not 'summary'), run_id match if provided, else newest. */
export function pickReview(
  reviews: ReviewRecord[],
  opts: { runId?: string } = {},
): ReviewRecord | undefined {
  const candidates = reviews.filter(r => r.kind === 'review');
  if (candidates.length === 0) return undefined;

  if (opts.runId) {
    const exact = candidates.find(r => r.run_id === opts.runId);
    if (exact) return exact;
  }

  // newest first by created_at
  return candidates.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

// ---- Response shaping ----

export interface ShapedFindings {
  verdict: string | null;
  score: number | null;
  total: number;
  returned: number;
  offset: number;
  counts: { critical: number; warning: number; suggestion: number };
  findings: ReturnType<typeof compactFinding>[] | ReturnType<typeof detailedFinding>[];
}

export function shapeFindings(
  review: ReviewRecord,
  opts: {
    format?: 'concise' | 'detailed';
    offset?: number;
    limit?: number;
  } = {},
): ShapedFindings {
  const format = opts.format ?? 'concise';
  const offset = opts.offset ?? 0;
  const limit  = opts.limit  ?? (format === 'concise' ? 10 : 20);

  const all = review.findings;
  const total = all.length;

  // Sort: CRITICAL first, then WARNING, then SUGGESTION
  const SEV_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
  const sorted = [...all].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3),
  );

  const page = sorted.slice(offset, offset + limit);

  const counts = {
    critical:   all.filter((f: FindingRecord) => f.severity === 'CRITICAL').length,
    warning:    all.filter((f: FindingRecord) => f.severity === 'WARNING').length,
    suggestion: all.filter((f: FindingRecord) => f.severity === 'SUGGESTION').length,
  };

  const findings = format === 'detailed'
    ? page.map(detailedFinding)
    : page.map(compactFinding);

  return {
    verdict: review.verdict,
    score: review.score,
    total,
    returned: page.length,
    offset,
    counts,
    findings,
  };
}
