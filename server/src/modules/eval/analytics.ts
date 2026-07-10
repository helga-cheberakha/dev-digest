/**
 * Eval analytics: history, compare, dashboard.
 *
 * Pure read-path service — reads from already-persisted eval_runs rows via the
 * repository. Does NOT run new evals (see service.ts for that).
 *
 * Layer: Application (service) — may depend on the container and repository
 * interfaces but must NOT import adapters or db/schema directly.
 */
import type { Container } from '../../platform/container.js';
import {
  EvalExpectedOutput,
  EvalActualOutput,
} from '../../vendor/shared/contracts/eval-ci.js';
import type {
  EvalRunBatch,
  EvalCompare,
  EvalDashboard,
  EvalTrendPoint,
  EvalRunRecord,
} from '../../vendor/shared/contracts/eval-ci.js';
import { scoreCase, aggregate } from './scoring.js';
import type { AggregateCase } from './scoring.js';

// ---------------------------------------------------------------------------
// Internal type helpers
// ---------------------------------------------------------------------------

type AggRunRow = Awaited<ReturnType<Container['evalRepo']['batchRunsWithExpectedForOwner']>>[number];
type RecentRunRow = Awaited<ReturnType<Container['evalRepo']['recentRuns']>>[number];

/**
 * Safely convert a DB timestamp (Date | string | unknown) to an ISO string.
 * postgres-js normally returns Date objects for TIMESTAMPTZ; the fallback
 * handles test mocks that pass plain strings.
 */
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Group per-run rows by batch_id and compute TRUE pooled recall / precision /
 * citation_accuracy via `scoring.scoreCase` + `scoring.aggregate`.
 *
 * This matches the formula used during live batch execution in `service.runBatch`:
 *   recall = sum(matchedExpected) / sum(totalExpected)
 *   precision = sum(nonNoiseActuals) / sum(totalActuals)
 *   citation_accuracy = sum(kept) / sum(produced)
 *
 * Runs with `pass: null` (failed with an LLM/runtime error) are counted in
 * `tracesTotal` and `tracesPassed` but excluded from the pooled metric
 * computation — matching the `successCases`-only accumulation in `runBatch`.
 */
function aggregateRunRows(runRows: AggRunRow[]): EvalRunBatch[] {
  // Group by batchId, preserving insertion order (rows ordered by ranAt asc).
  const batchMap = new Map<string, AggRunRow[]>();
  for (const row of runRows) {
    const bid = row.batchId!; // batchRunsWithExpectedForOwner excludes NULL batch_ids
    const bucket = batchMap.get(bid);
    if (bucket) {
      bucket.push(row);
    } else {
      batchMap.set(bid, [row]);
    }
  }

  const batches: EvalRunBatch[] = [];

  for (const [batchId, runs] of batchMap) {
    // Batch-level metadata
    let maxRanAt: unknown = runs[0]!.ranAt;
    const agentVersion = runs[0]!.agentVersion ?? null;
    let tracesPassed = 0;
    let tracesTotal = 0;

    // Pooled aggregation accumulators (successful runs only)
    const aggregateCases: AggregateCase[] = [];
    let totalKept = 0;
    let totalProduced = 0;

    for (const run of runs) {
      // Update max ranAt
      const runDate = run.ranAt;
      if (runDate instanceof Date && maxRanAt instanceof Date && runDate > maxRanAt) {
        maxRanAt = runDate;
      }

      tracesTotal++;
      if (run.pass === true) tracesPassed++;

      // Skip errored runs for pooled metric computation (pass: null = error).
      // This matches `runBatch`'s `successCases`-only accumulation.
      if (run.pass === null) continue;

      const actualParsed = EvalActualOutput.safeParse(run.actualOutput);
      const expectedParsed = EvalExpectedOutput.safeParse(run.expectedOutput);

      // Defensively skip any malformed stored rows
      if (!actualParsed.success || !expectedParsed.success) continue;

      const actualRegions = actualParsed.data.findings.map((f) => ({
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        severity: f.severity,
        category: f.category,
      }));

      const caseScore = scoreCase({
        expectation: expectedParsed.data.expectation,
        expectedRegions: expectedParsed.data.regions,
        actualRegions,
      });

      aggregateCases.push({
        name: run.caseName,
        score: caseScore,
        expected: expectedParsed.data.regions,
        actual: actualRegions,
      });

      totalKept += actualParsed.data.grounding.kept;
      totalProduced += actualParsed.data.grounding.produced;
    }

    const result = aggregate(aggregateCases, { kept: totalKept, produced: totalProduced });

    batches.push({
      batch_id: batchId,
      ran_at: toIso(maxRanAt),
      agent_version: agentVersion,
      recall: result.recall,
      precision: result.precision,
      citation_accuracy: result.citation_accuracy,
      traces_passed: tracesPassed,
      traces_total: tracesTotal,
    });
  }

  // Sort newest first (ISO strings sort lexicographically in UTC)
  batches.sort((a, b) => (b.ran_at > a.ran_at ? 1 : b.ran_at < a.ran_at ? -1 : 0));

  return batches;
}

function recentRunRowToRecord(row: RecentRunRow): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName ?? null,
    ran_at: toIso(row.ranAt),
    actual_output: null,
    pass: row.pass ?? null,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    duration_ms: null,
    cost_usd: null,
    batch_id: row.batchId ?? null,
    agent_version: row.agentVersion ?? null,
  };
}

// ---------------------------------------------------------------------------
// resolveAlert — priority-ordered regression / floor-warning check
// ---------------------------------------------------------------------------

/**
 * Compute the alert message for an agent owner, priority-ordered:
 *
 * 1. If the last two batches exist, diff per-case pass between them. Any case
 *    that flipped true → false is a regression. Return the message for the
 *    alphabetically-first regressed case. Regression takes priority even when
 *    the total case count is ≥ 8.
 * 2. If fewer than 8 cases exist (and no regression found), return the
 *    floor-warning message.
 * 3. Otherwise return null.
 *
 * `batches` must be newest-first (as returned by `history`).
 */
async function resolveAlert(
  container: Container,
  workspaceId: string,
  ownerId: string,
  batches: EvalRunBatch[],
): Promise<string | null> {
  // Fetch cases once — needed both for the expectation-type lookup in step 1
  // and the count check in step 2.
  const cases = await container.evalRepo.listCases(workspaceId, 'agent', ownerId);

  // Step 1: take the two most recent batches (batches is newest-first)
  const [newest, second] = batches;
  if (newest && second) {
    const [newerRuns, olderRuns] = await Promise.all([
      container.evalRepo.runsForBatch(workspaceId, ownerId, newest.batch_id),
      container.evalRepo.runsForBatch(workspaceId, ownerId, second.batch_id),
    ]);

    // Build caseId → pass map for the OLDER batch
    const olderPassMap = new Map<string, boolean>();
    for (const r of olderRuns) {
      if (r.pass != null) olderPassMap.set(r.caseId, r.pass);
    }

    // Collect cases present in BOTH batches that flipped pass: true → false
    const regressions: Array<{ caseId: string; caseName: string }> = [];
    for (const r of newerRuns) {
      if (olderPassMap.get(r.caseId) === true && r.pass === false) {
        regressions.push({ caseId: r.caseId, caseName: r.caseName });
      }
    }

    if (regressions.length > 0) {
      // Sort by case name ascending, pick the first (alphabetically earliest)
      regressions.sort((a, b) => a.caseName.localeCompare(b.caseName));
      const first = regressions[0]!;

      // Determine expectation type to pick the right message template
      const caseRow = cases.find((c) => c.id === first.caseId);
      const expectedOutput = caseRow?.expectedOutput as
        | { expectation?: 'must_find' | 'must_not_flag' }
        | null
        | undefined;

      if (expectedOutput?.expectation === 'must_not_flag') {
        return `New false positive: case '${first.caseName}' now flags a finding it previously didn't.`;
      }
      // Default: must_find (or unknown expectation — treat as regression)
      return `Regression: case '${first.caseName}' no longer finds the expected issue.`;
    }
  }

  // Step 2: floor warning — fewer than the recommended minimum
  if (cases.length < 8) {
    return `Only ${cases.length} eval cases — add more for reliable regression detection (recommended minimum: 8).`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// EvalAnalytics — public API
// ---------------------------------------------------------------------------

export class EvalAnalytics {
  constructor(private readonly container: Container) {}

  /**
   * Returns one aggregate per distinct batch_id for the given agent,
   * newest batch first.
   *
   * Fetches per-run rows (with each case's stored `expected_output` and
   * `actual_output`) via `batchRunsWithExpectedForOwner`, then computes
   * TRUE pooled recall / precision / citation_accuracy in JS using the same
   * `scoring.scoreCase` + `scoring.aggregate` functions used during live batch
   * execution — guaranteeing that reading a batch back via history produces
   * EXACTLY the same metrics as `POST /agents/:id/eval-runs` returned.
   */
  async history(workspaceId: string, agentId: string): Promise<EvalRunBatch[]> {
    const runRows = await this.container.evalRepo.batchRunsWithExpectedForOwner(
      workspaceId,
      agentId,
    );
    return aggregateRunRows(runRows);
  }

  /**
   * Side-by-side comparison of two batch runs.
   *
   * `delta` = b - a (b is intended to be the newer / candidate batch,
   * a is the baseline). The caller decides which is newer; this function
   * does not enforce ordering.
   *
   * `prompt_diff` is a `{ old, new }` pair carrying the raw `system_prompt`
   * text for each batch's `agent_version` snapshot — a later client task
   * renders the visual line-diff from these strings.
   */
  async compare(
    workspaceId: string,
    agentId: string,
    batchIdA: string,
    batchIdB: string,
  ): Promise<EvalCompare> {
    const batches = await this.history(workspaceId, agentId);
    const batchA = batches.find((b) => b.batch_id === batchIdA);
    const batchB = batches.find((b) => b.batch_id === batchIdB);
    if (!batchA) throw new Error(`Eval batch not found: ${batchIdA}`);
    if (!batchB) throw new Error(`Eval batch not found: ${batchIdB}`);

    // Resolve prompt text from agent_version snapshots in parallel
    const [snapA, snapB] = await Promise.all([
      batchA.agent_version != null
        ? this.container.agentsRepo.getVersion(agentId, batchA.agent_version)
        : Promise.resolve(undefined),
      batchB.agent_version != null
        ? this.container.agentsRepo.getVersion(agentId, batchB.agent_version)
        : Promise.resolve(undefined),
    ]);

    // configJson shape: { system_prompt, provider, model, ... } — see agents/repository.ts
    const cfgA = snapA?.configJson as { system_prompt?: string } | null | undefined;
    const cfgB = snapB?.configJson as { system_prompt?: string } | null | undefined;

    return {
      a: batchA,
      b: batchB,
      prompt_diff: {
        old: cfgA?.system_prompt ?? null,
        new: cfgB?.system_prompt ?? null,
      },
      delta: {
        recall: batchB.recall - batchA.recall,
        precision: batchB.precision - batchA.precision,
        citation_accuracy: batchB.citation_accuracy - batchA.citation_accuracy,
      },
    };
  }

  /**
   * Dashboard for a single agent (`ownerId` given) or workspace-wide
   * (`ownerId` null).
   *
   * - Single-agent: current metrics from the newest batch, delta vs previous,
   *   chronological trend, and a per-agent alert. `recent_runs` is empty.
   * - Workspace-level: workspace-wide `recent_runs`, zero-value current/delta
   *   (no single owner to aggregate), and `alert: null`.
   */
  async dashboard(workspaceId: string, ownerId: string | null): Promise<EvalDashboard> {
    if (ownerId !== null) {
      return this._agentDashboard(workspaceId, ownerId);
    }
    return this._workspaceDashboard(workspaceId);
  }

  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  private async _agentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    // Fetch batches and cases in parallel; alert resolution happens after batches
    // are known (it may fetch runsForBatch internally for regression detection).
    const [batches, cases] = await Promise.all([
      this.history(workspaceId, agentId),
      this.container.evalRepo.listCases(workspaceId, 'agent', agentId),
    ]);

    const alert = await resolveAlert(this.container, workspaceId, agentId, batches);

    const current = batches[0];
    const prev = batches[1];

    // trend: one point per batch in chronological order (batches is newest-first)
    const trend: EvalTrendPoint[] = [...batches].reverse().map((b) => ({
      ran_at: b.ran_at,
      recall: b.recall,
      precision: b.precision,
      citation_accuracy: b.citation_accuracy,
      pass_rate: b.traces_total > 0 ? b.traces_passed / b.traces_total : 1,
      cost_usd: null,
    }));

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: cases.length,
      current: {
        recall: current?.recall ?? 0,
        precision: current?.precision ?? 0,
        citation_accuracy: current?.citation_accuracy ?? 0,
        traces_passed: current?.traces_passed ?? 0,
        traces_total: current?.traces_total ?? 0,
        cost_usd: null,
      },
      delta: {
        recall: current && prev ? current.recall - prev.recall : 0,
        precision: current && prev ? current.precision - prev.precision : 0,
        citation_accuracy:
          current && prev ? current.citation_accuracy - prev.citation_accuracy : 0,
      },
      trend,
      recent_runs: [],
      alert,
    };
  }

  private async _workspaceDashboard(workspaceId: string): Promise<EvalDashboard> {
    const recentRows = await this.container.evalRepo.recentRuns(workspaceId);

    return {
      owner_kind: null,
      owner_id: null,
      cases_total: 0,
      current: {
        recall: 0,
        precision: 0,
        citation_accuracy: 0,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
      trend: [],
      recent_runs: recentRows.map(recentRunRowToRecord),
      alert: null,
    };
  }
}
