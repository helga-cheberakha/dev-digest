import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  EvalExpectedOutput,
  type EvalCaseInput,
  type EvalRegion,
} from '../../vendor/shared/contracts/eval-ci.js';
import type { EvalRun } from '../../vendor/shared/contracts/knowledge.js';
import * as scoring from './scoring.js';
import type { AggregateCase } from './scoring.js';
import { runCase } from './run.js';
import type * as t from '../../db/schema.js';

/**
 * A persisted eval case row augmented with the case's most recent run outcome.
 * Returned by listCases so the UI can render pass/fail badges without a
 * second round-trip.
 */
export type CaseWithLatestRun = typeof t.evalCases.$inferSelect & {
  latestRun: {
    ranAt: Date;
    pass: boolean | null;
    recall: number | null;
    precision: number | null;
    citationAccuracy: number | null;
    batchId: string | null;
    agentVersion: number | null;
  } | null;
};

// ---------------------------------------------------------------------------
// buildCaseDraftFromFinding
// ---------------------------------------------------------------------------

/**
 * Build an unpersisted eval case draft from an accepted or dismissed finding.
 *
 * INVARIANT: this function NEVER calls `evalRepo.insertCase`. It only reads.
 * The caller is responsible for deciding whether and when to persist (via
 * `createCase`). Breaking this invariant silently destroys the "review-before-
 * save" UX guarantee the client depends on.
 */
export async function buildCaseDraftFromFinding(
  container: Container,
  workspaceId: string,
  findingId: string,
): Promise<EvalCaseInput> {
  const ctx = await container.reviewRepo.findingContext(findingId);

  // Both "not found" and "belongs to another workspace" map to 404 to avoid
  // leaking the existence of cross-workspace findings.
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  const { finding, review, pull } = ctx;

  // Derive expectation from the finding's persisted decision ONLY.
  // NEVER derive from any request body — there is none for this endpoint.
  let expectation: 'must_find' | 'must_not_flag';
  if (finding.acceptedAt) {
    expectation = 'must_find';
  } else if (finding.dismissedAt) {
    expectation = 'must_not_flag';
  } else {
    throw new ValidationError(
      'Finding has no accepted or dismissed decision; cannot derive expectation',
    );
  }

  // Build input_diff from the per-file patch stored in prFiles.
  // Deliberate deviation: when the file is not in the stored diff, return ''
  // (do NOT fall back to the whole raw diff — the modal must show the user an
  // obviously-empty field to fix, not garbage from an unrelated file).
  const prFiles = await container.reviewRepo.getPrFiles(pull.id);
  const fileRow = prFiles.find((f) => f.path === finding.file);
  const input_diff = fileRow ? (fileRow.patch ?? '') : '';

  // The review's agentId is the owning agent for the case.
  const owner_id = review.agentId;
  if (!owner_id) {
    throw new ValidationError('Finding belongs to a review with no owning agent');
  }

  const region: EvalRegion = {
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
    // Cast from DB string to contract enum: both share the same domain values;
    // the casts are safe because the DB row was validated on insert.
    severity: finding.severity as EvalRegion['severity'],
    category: finding.category as EvalRegion['category'],
  };

  return {
    owner_kind: 'agent',
    owner_id,
    name: finding.title,
    input_diff,
    input_files: null,
    input_meta: { source_finding_id: findingId },
    expected_output: { expectation, regions: [region] },
    notes: null,
  };
}

// ---------------------------------------------------------------------------
// createCase
// ---------------------------------------------------------------------------

/**
 * Persist an eval case (the ONE function that calls `repo.insertCase`).
 *
 * `safeParse`s `expected_output` against `EvalExpectedOutput` before inserting.
 * On validation failure, throws a 422-class `ValidationError` and inserts nothing.
 *
 * This function is used for both fully-manual cases and for saving a
 * (possibly user-edited) finding-derived draft — it does not assume its input
 * came from `buildCaseDraftFromFinding`.
 */
export async function createCase(
  container: Container,
  workspaceId: string,
  input: EvalCaseInput,
): Promise<typeof t.evalCases.$inferSelect> {
  const parseResult = EvalExpectedOutput.safeParse(input.expected_output);
  if (!parseResult.success) {
    throw new ValidationError('Invalid expected_output', parseResult.error.issues);
  }

  // Verify the target agent belongs to the caller's workspace.
  // Without this check a client could create an orphaned case referencing a
  // nonexistent or foreign-workspace agent id.
  const agent = await container.agentsRepo.getById(workspaceId, input.owner_id);
  if (!agent) {
    throw new NotFoundError('Agent not found in workspace');
  }

  return container.evalRepo.insertCase({
    workspaceId,
    ownerKind: input.owner_kind,
    ownerId: input.owner_id,
    name: input.name,
    inputDiff: input.input_diff ?? '',
    inputFiles: input.input_files ?? null,
    inputMeta: input.input_meta ?? null,
    expectedOutput: input.expected_output,
    notes: input.notes ?? null,
  });
}

// ---------------------------------------------------------------------------
// listCases
// ---------------------------------------------------------------------------

/**
 * List all eval cases for an agent, with each case's latest run attached.
 */
export async function listCases(
  container: Container,
  workspaceId: string,
  agentId: string,
): Promise<CaseWithLatestRun[]> {
  const [cases, latestRuns] = await Promise.all([
    container.evalRepo.listCases(workspaceId, 'agent', agentId),
    container.evalRepo.latestRunPerCase(workspaceId, agentId),
  ]);

  const runByCaseId = new Map(latestRuns.map((r) => [r.caseId, r]));

  return cases.map((c) => {
    const run = runByCaseId.get(c.id) ?? null;
    return {
      ...c,
      latestRun: run
        ? {
            ranAt: run.ranAt,
            pass: run.pass ?? null,
            recall: run.recall ?? null,
            precision: run.precision ?? null,
            citationAccuracy: run.citationAccuracy ?? null,
            batchId: run.batchId ?? null,
            agentVersion: run.agentVersion ?? null,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// runCaseOnce
// ---------------------------------------------------------------------------

/**
 * Run a single eval case (used by "Run case" / "Run on save" from the client).
 * Generates its own isolated batchId so the run can be tracked individually.
 */
export async function runCaseOnce(
  container: Container,
  workspaceId: string,
  caseId: string,
): Promise<{ runId: string; caseId: string; result: EvalRun }> {
  const evalCase = await container.evalRepo.getCase(workspaceId, caseId);
  if (!evalCase) throw new NotFoundError('Eval case not found');

  const agent = await container.agentsRepo.getById(workspaceId, evalCase.ownerId);
  if (!agent) throw new NotFoundError('Agent not found for eval case');

  const linked = await container.agentsRepo.linkedSkills(agent.id);
  const skillBodies = linked
    .filter((l) => l.skill.enabled && !l.skill.injectionDetected)
    .map((l) => l.skill.body);

  const batchId = randomUUID();

  const output = await runCase(container, agent, skillBodies, { inputDiff: evalCase.inputDiff });

  const { expectation, expectedRegions } = _parseExpected(evalCase.expectedOutput);

  const actualRegions = _findingsToRegions(output.findings);

  const caseScore = scoring.scoreCase({ expectation, expectedRegions, actualRegions });
  const aggCase: AggregateCase = {
    name: evalCase.name,
    score: caseScore,
    expected: expectedRegions,
    actual: actualRegions,
  };
  const result = scoring.aggregate([aggCase], { kept: output.kept, produced: output.produced });

  const row = await container.evalRepo.insertRun(caseId, {
    batchId,
    agentVersion: agent.version,
    pass: caseScore.pass,
    recall: result.recall,
    precision: result.precision,
    citationAccuracy: result.citation_accuracy,
    durationMs: null,
    costUsd: null,
    actualOutput: _buildActualOutput(output.findings, output.kept, output.produced),
  });

  return { runId: row.id, caseId, result };
}

// ---------------------------------------------------------------------------
// runBatch
// ---------------------------------------------------------------------------

/**
 * Run all eval cases for an agent in a single batch.
 *
 * Execution is SEQUENTIAL (not concurrent) — deliberate simplicity decision.
 *
 * - Empty case set: returns a zero aggregate and persists NOTHING.
 * - Per-case LLM errors are caught: the failed row is persisted with
 *   `pass: null` and the error message in `actual_output.error`; execution
 *   continues to the next case. Results from passing cases are preserved.
 * - All persisted rows in one batch share the same `batchId` and `agentVersion`.
 */
export async function runBatch(
  container: Container,
  workspaceId: string,
  agentId: string,
): Promise<EvalRun> {
  const cases = await container.evalRepo.listCases(workspaceId, 'agent', agentId);

  // Empty set: aggregate vacuously, persist nothing.
  if (cases.length === 0) {
    return scoring.aggregate([], { kept: 0, produced: 0 });
  }

  const agent = await container.agentsRepo.getById(workspaceId, agentId);
  if (!agent) throw new NotFoundError('Agent not found');

  const linked = await container.agentsRepo.linkedSkills(agent.id);
  const skillBodies = linked
    .filter((l) => l.skill.enabled && !l.skill.injectionDetected)
    .map((l) => l.skill.body);

  // ONE batchId for the whole batch — all rows share it.
  const batchId = randomUUID();

  const successCases: AggregateCase[] = [];
  let totalKept = 0;
  let totalProduced = 0;

  for (const evalCase of cases) {
    try {
      const output = await runCase(container, agent, skillBodies, {
        inputDiff: evalCase.inputDiff,
      });

      const { expectation, expectedRegions } = _parseExpected(evalCase.expectedOutput);
      const actualRegions = _findingsToRegions(output.findings);

      const caseScore = scoring.scoreCase({ expectation, expectedRegions, actualRegions });
      const aggCase: AggregateCase = {
        name: evalCase.name,
        score: caseScore,
        expected: expectedRegions,
        actual: actualRegions,
      };

      // Compute per-case metrics for the individual run row.
      const perCaseResult = scoring.aggregate([aggCase], {
        kept: output.kept,
        produced: output.produced,
      });

      await container.evalRepo.insertRun(evalCase.id, {
        batchId,
        agentVersion: agent.version,
        pass: caseScore.pass,
        recall: perCaseResult.recall,
        precision: perCaseResult.precision,
        citationAccuracy: perCaseResult.citation_accuracy,
        durationMs: null,
        costUsd: null,
        actualOutput: _buildActualOutput(output.findings, output.kept, output.produced),
      });

      // Accumulate for the pooled batch aggregate.
      successCases.push(aggCase);
      totalKept += output.kept;
      totalProduced += output.produced;
    } catch (err) {
      // Per-case failure: persist a failed row and continue.
      const errMsg = err instanceof Error ? err.message : String(err);
      await container.evalRepo.insertRun(evalCase.id, {
        batchId,
        agentVersion: agent.version,
        pass: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: null,
        costUsd: null,
        actualOutput: {
          findings: [],
          grounding: { kept: 0, produced: 0 },
          error: errMsg,
        },
      });
    }
  }

  // Pooled aggregate over successfully-scored cases only.
  return scoring.aggregate(successCases, { kept: totalKept, produced: totalProduced });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse the persisted expected_output into a typed shape (graceful fallback). */
function _parseExpected(raw: unknown): {
  expectation: 'must_find' | 'must_not_flag';
  expectedRegions: EvalRegion[];
} {
  const parsed = EvalExpectedOutput.safeParse(raw);
  if (parsed.success) {
    return {
      expectation: parsed.data.expectation,
      expectedRegions: parsed.data.regions,
    };
  }
  // Fallback when stored data is malformed: score as must_find with no regions.
  return { expectation: 'must_find', expectedRegions: [] };
}

/** Map reviewer-core findings to EvalRegion[] for scoring. */
function _findingsToRegions(
  findings: { file: string; start_line: number; end_line: number; severity: string; category: string }[],
): EvalRegion[] {
  return findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity as EvalRegion['severity'],
    category: f.category as EvalRegion['category'],
  }));
}

/** Build the actual_output JSONB payload for an eval_runs row. */
function _buildActualOutput(
  findings: { id: string; severity: string; category: string; title: string; file: string; start_line: number; end_line: number }[],
  kept: number,
  produced: number,
): object {
  return {
    findings: findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
    })),
    grounding: { kept, produced },
  };
}
