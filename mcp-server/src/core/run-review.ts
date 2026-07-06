import type { Client } from '../http/client.js';
import { pickReview, shapeFindings, type ShapedFindings } from '../core/findings.js';

// ---- Types ----

export type RunReviewResult =
  | { kind: 'done' } & ShapedFindings
  | { kind: 'running'; run_id: string }
  | { kind: 'failed'; run_id: string; error: string };

interface RunReviewOpts {
  pollIntervalMs: number;
  runTimeoutMs: number;
}

interface RunReviewDeps {
  pickReview: typeof pickReview;
  shapeFindings: typeof shapeFindings;
}

// ---- Helper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Main export ----

export async function runReviewAndWait(
  client: Client,
  { pullId, agentId }: { pullId: string; agentId: string },
  opts: RunReviewOpts,
  deps: RunReviewDeps,
): Promise<RunReviewResult> {
  // 1. Trigger the review (fire-and-forget on server side)
  const response = await client.triggerReview(pullId, agentId);
  const runId = response.runs[0]?.run_id;
  if (!runId) {
    return { kind: 'failed', run_id: '', error: 'Review trigger returned no run id.' };
  }

  // 2. Poll until done or timeout
  const deadline = Date.now() + opts.runTimeoutMs;

  while (Date.now() < deadline) {
    await sleep(opts.pollIntervalMs);

    const runs = await client.listRuns(pullId);
    const target = runs.find(r => r.run_id === runId);

    // If run not found or status is not a terminal state, keep polling
    const status = target?.status;
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      // Terminal state reached
      if (status === 'failed' || status === 'cancelled') {
        return {
          kind: 'failed',
          run_id: runId,
          error: target?.error ?? status,
        };
      }

      // status === 'done' — fetch the review
      const reviews = await client.listReviews(pullId);
      const review = deps.pickReview(reviews, { runId });

      if (!review) {
        return {
          kind: 'failed',
          run_id: runId,
          error: 'Review completed but result not found. Try devdigest_get_findings.',
        };
      }

      const shaped = deps.shapeFindings(review, { format: 'concise', offset: 0, limit: 10 });
      return { kind: 'done', ...shaped };
    }
    // null / 'running' / unknown → continue polling
  }

  // Timeout
  return { kind: 'running', run_id: runId };
}
