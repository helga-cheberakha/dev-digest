import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  EvalExpectedOutput,
  type EvalCaseInput,
  type EvalRegion,
  type EvalBenchmark,
  type EvalBenchmarkCaseResult,
} from '../../vendor/shared/contracts/eval-ci.js';
import type { EvalRun } from '../../vendor/shared/contracts/knowledge.js';
import * as scoring from './scoring.js';
import type { AggregateCase } from './scoring.js';
import { runCase } from './run.js';
import * as harness from './harness.js';
import type { EvalCaseRow } from './repository.js';

/**
 * A persisted eval case row augmented with the case's most recent run outcome.
 * Returned by listCases so the UI can render pass/fail badges without a
 * second round-trip.
 */
export type CaseWithLatestRun = EvalCaseRow & {
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
    throw new ValidationError(
      "This finding wasn't reviewed by an agent, so it can't seed an eval case. Accept or dismiss a finding from an agent-run review instead.",
    );
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
): Promise<EvalCaseRow> {
  const parseResult = EvalExpectedOutput.safeParse(input.expected_output);
  if (!parseResult.success) {
    throw new ValidationError('Invalid expected_output', parseResult.error.issues);
  }

  // Verify the target owner (agent or skill) belongs to the caller's workspace.
  // Without this check a client could create an orphaned case referencing a
  // nonexistent or foreign-workspace entity.
  if (input.owner_kind === 'skill') {
    const skill = await container.skillsRepo.getById(workspaceId, input.owner_id);
    if (!skill) {
      throw new NotFoundError('Skill not found in workspace');
    }
  } else {
    const agent = await container.agentsRepo.getById(workspaceId, input.owner_id);
    if (!agent) {
      throw new NotFoundError('Agent not found in workspace');
    }
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
// updateCase
// ---------------------------------------------------------------------------

/**
 * Update an existing eval case in place (the ONE function that calls
 * `repo.updateCase`). Mirrors `createCase`'s validation: `safeParse`s
 * `expected_output` and verifies the owner belongs to the caller's workspace.
 * Throws NotFoundError if the case doesn't exist in this workspace.
 */
export async function updateCase(
  container: Container,
  workspaceId: string,
  caseId: string,
  input: EvalCaseInput,
): Promise<EvalCaseRow> {
  const parseResult = EvalExpectedOutput.safeParse(input.expected_output);
  if (!parseResult.success) {
    throw new ValidationError('Invalid expected_output', parseResult.error.issues);
  }

  if (input.owner_kind === 'skill') {
    const skill = await container.skillsRepo.getById(workspaceId, input.owner_id);
    if (!skill) {
      throw new NotFoundError('Skill not found in workspace');
    }
  } else {
    const agent = await container.agentsRepo.getById(workspaceId, input.owner_id);
    if (!agent) {
      throw new NotFoundError('Agent not found in workspace');
    }
  }

  const row = await container.evalRepo.updateCase(workspaceId, caseId, {
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
  if (!row) throw new NotFoundError('Eval case not found');
  return row;
}

// ---------------------------------------------------------------------------
// listCases
// ---------------------------------------------------------------------------

/**
 * List all eval cases for an owner (agent or skill), with each case's latest
 * run attached.
 */
export async function listCases(
  container: Container,
  workspaceId: string,
  ownerKind: 'agent' | 'skill',
  ownerId: string,
): Promise<CaseWithLatestRun[]> {
  const [cases, latestRuns] = await Promise.all([
    container.evalRepo.listCases(workspaceId, ownerKind, ownerId),
    container.evalRepo.latestRunPerCase(workspaceId, ownerId),
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
// deleteCase
// ---------------------------------------------------------------------------

/** Delete an eval case (and its run history, via FK cascade). */
export async function deleteCase(
  container: Container,
  workspaceId: string,
  caseId: string,
): Promise<void> {
  const deleted = await container.evalRepo.deleteCase(workspaceId, caseId);
  if (!deleted) throw new NotFoundError('Eval case not found');
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

  const batchId = randomUUID();

  // Branch on owner kind — skill vs agent paths produce identical output shapes.
  // ownerVersion, output, and durationMs are set in exactly one branch before
  // reaching the shared score+persist tail below.
  let ownerVersion: number;
  let output: Awaited<ReturnType<typeof runCase>>;
  let durationMs: number;

  if (evalCase.ownerKind === 'skill') {
    const skill = await container.skillsRepo.getById(workspaceId, evalCase.ownerId);
    if (!skill) throw new NotFoundError('Skill not found for eval case');
    if (skill.injectionDetected === true) {
      throw new ValidationError('Skill has injection detected; eval run refused');
    }
    ownerVersion = skill.version;
    const t0 = Date.now();
    output = await harness.runSkillCase(container, skill.body, { inputDiff: evalCase.inputDiff });
    durationMs = Date.now() - t0;
  } else {
    const agent = await container.agentsRepo.getById(workspaceId, evalCase.ownerId);
    if (!agent) throw new NotFoundError('Agent not found for eval case');
    const linked = await container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = linked
      .filter((l) => l.skill.enabled && !l.skill.injectionDetected)
      .map((l) => l.skill.body);
    ownerVersion = agent.version;
    const t0 = Date.now();
    output = await runCase(container, agent, skillBodies, { inputDiff: evalCase.inputDiff });
    durationMs = Date.now() - t0;
  }

  // Shared score+persist tail — identical for both owner kinds.
  const { expectation, expectedRegions } = _parseExpected(evalCase.expectedOutput);
  const actualRegions = _findingsToRegions(output.findings);
  const caseScore = scoring.scoreCase({ expectation, expectedRegions, actualRegions });
  const aggCase: AggregateCase = {
    name: evalCase.name,
    score: caseScore,
    expected: expectedRegions,
    actual: actualRegions,
  };
  const result = scoring.aggregate(
    [aggCase],
    { kept: output.kept, produced: output.produced },
    { durationMs, costUsd: output.costUsd },
  );

  const row = await container.evalRepo.insertRun(caseId, {
    batchId,
    agentVersion: ownerVersion,
    pass: caseScore.pass,
    recall: result.recall,
    precision: result.precision,
    citationAccuracy: result.citation_accuracy,
    durationMs,
    costUsd: output.costUsd,
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
  // Accumulated cost across all cases: null-cost cases contribute 0 to the sum.
  let batchCostUsd = 0;
  const batchStart = Date.now();

  for (const evalCase of cases) {
    try {
      const caseStart = Date.now();
      const output = await runCase(container, agent, skillBodies, {
        inputDiff: evalCase.inputDiff,
      });
      const caseDurationMs = Date.now() - caseStart;

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
        durationMs: caseDurationMs,
        costUsd: output.costUsd,
        actualOutput: _buildActualOutput(output.findings, output.kept, output.produced),
      });

      // Accumulate for the pooled batch aggregate.
      // Null cost from any case contributes 0 (not NaN) to the batch total.
      batchCostUsd += output.costUsd ?? 0;
      successCases.push(aggCase);
      totalKept += output.kept;
      totalProduced += output.produced;
    } catch (err) {
      // Per-case failure: persist a failed row and continue.
      // Errored cases contribute 0 cost to the batch total (no accumulation here).
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
  // recall/precision/citation_accuracy are pooled purely over the cases that scored —
  // errored cases have no valid findings data to contribute to that math.
  const batchResult = scoring.aggregate(
    successCases,
    { kept: totalKept, produced: totalProduced },
    { durationMs: Date.now() - batchStart, costUsd: batchCostUsd },
  );

  // AC-6: traces_total must equal ALL cases attempted in the batch (including per-case
  // LLM errors persisted with pass: null), not just the successfully-scored ones.
  // scoring.aggregate derives traces_total from cases.length of the array it receives;
  // we override it here to reflect the full batch count.
  // traces_passed is already correct: errored cases are absent from successCases so
  // they are never counted as passed.
  return {
    ...batchResult,
    traces_total: cases.length,
  };
}

// ---------------------------------------------------------------------------
// runSkillBatch
// ---------------------------------------------------------------------------

/**
 * Run all eval cases for a skill in a single batch.
 *
 * Mirrors `runBatch` for skills. Execution is SEQUENTIAL (not concurrent).
 *
 * - Empty case set: returns a zero aggregate and persists NOTHING.
 * - `injectionDetected` skill: throws ValidationError, persists NOTHING.
 * - Per-case LLM errors are caught: the failed row is persisted with
 *   `pass: null` and the error message in `actual_output.error`; execution
 *   continues to the next case.
 * - All rows in one batch share the same `batchId` and `agentVersion`
 *   (the skill's version, stored in the legacy `agent_version` column).
 */
export async function runSkillBatch(
  container: Container,
  workspaceId: string,
  skillId: string,
): Promise<EvalRun> {
  const cases = await container.evalRepo.listCases(workspaceId, 'skill', skillId);

  // Empty set: aggregate vacuously, persist nothing.
  if (cases.length === 0) {
    return scoring.aggregate([], { kept: 0, produced: 0 });
  }

  const skill = await container.skillsRepo.getById(workspaceId, skillId);
  if (!skill) throw new NotFoundError('Skill not found');
  if (skill.injectionDetected === true) {
    throw new ValidationError('Skill has injection detected; eval run refused');
  }

  // ONE batchId for the whole batch — all rows share it.
  const batchId = randomUUID();

  const successCases: AggregateCase[] = [];
  let totalKept = 0;
  let totalProduced = 0;
  // Accumulated cost across all cases: null-cost cases contribute 0 to the sum.
  let batchCostUsd = 0;
  const batchStart = Date.now();

  for (const evalCase of cases) {
    try {
      const caseStart = Date.now();
      const output = await harness.runSkillCase(container, skill.body, {
        inputDiff: evalCase.inputDiff,
      });
      const caseDurationMs = Date.now() - caseStart;

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
        agentVersion: skill.version,
        pass: caseScore.pass,
        recall: perCaseResult.recall,
        precision: perCaseResult.precision,
        citationAccuracy: perCaseResult.citation_accuracy,
        durationMs: caseDurationMs,
        costUsd: output.costUsd,
        actualOutput: _buildActualOutput(output.findings, output.kept, output.produced),
      });

      // Accumulate for the pooled batch aggregate.
      batchCostUsd += output.costUsd ?? 0;
      successCases.push(aggCase);
      totalKept += output.kept;
      totalProduced += output.produced;
    } catch (err) {
      // Per-case failure: persist a failed row and continue.
      const errMsg = err instanceof Error ? err.message : String(err);
      await container.evalRepo.insertRun(evalCase.id, {
        batchId,
        agentVersion: skill.version,
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
  const batchResult = scoring.aggregate(
    successCases,
    { kept: totalKept, produced: totalProduced },
    { durationMs: Date.now() - batchStart, costUsd: batchCostUsd },
  );

  // traces_total must equal ALL cases attempted (including per-case LLM errors).
  return {
    ...batchResult,
    traces_total: cases.length,
  };
}

// ---------------------------------------------------------------------------
// runSkillBenchmark
// ---------------------------------------------------------------------------

/**
 * Run all eval cases for a skill in candidate-vs-baseline benchmark mode.
 *
 * For each case, BOTH arms are executed sequentially:
 * - Candidate arm: `runSkillCase` with `[skill.body]` injected (the skill under test).
 * - Baseline arm: `runSkillBaselineCase` with `skills: []` (zero skill influence).
 *
 * CRITICAL (AC-23): ONLY candidate rows are persisted to eval_runs. Persisting a
 * baseline row would corrupt the case's "latest run" badge and pollute metric tiles
 * (those read paths are owner-id-filtered, not configuration-aware).
 *
 * - Empty case set: returns zero aggregates, persists NOTHING (AC-25).
 * - `injectionDetected` skill: throws ValidationError, persists NOTHING (AC-24).
 * - Candidate LLM error on a case: persists a failed candidate row (pass: null,
 *   error in actual_output), records candidate_pass: null; continues (AC-26).
 * - Baseline LLM error on a case: NO row persisted; records baseline_pass: null;
 *   continues (AC-26).
 * - delta = candidate_aggregate − baseline_aggregate per metric (AC-20).
 * - Both aggregates have traces_total overridden to cases.length (all attempted).
 */
export async function runSkillBenchmark(
  container: Container,
  workspaceId: string,
  skillId: string,
): Promise<EvalBenchmark> {
  const cases = await container.evalRepo.listCases(workspaceId, 'skill', skillId);

  // Empty set: aggregate vacuously, persist nothing (AC-25).
  if (cases.length === 0) {
    return {
      candidate: scoring.aggregate([], { kept: 0, produced: 0 }),
      baseline: scoring.aggregate([], { kept: 0, produced: 0 }),
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
      per_case: [],
    };
  }

  const skill = await container.skillsRepo.getById(workspaceId, skillId);
  if (!skill) throw new NotFoundError('Skill not found');
  if (skill.injectionDetected === true) {
    throw new ValidationError('Skill has injection detected; eval run refused');
  }

  // ONE batchId for the whole benchmark — all candidate rows share it.
  const batchId = randomUUID();

  const candidateSuccessCases: AggregateCase[] = [];
  const baselineSuccessCases: AggregateCase[] = [];
  let candidateTotalKept = 0;
  let candidateTotalProduced = 0;
  let baselineTotalKept = 0;
  let baselineTotalProduced = 0;
  let candidateCostUsd = 0;
  let baselineCostUsd = 0;
  let candidateDurationMs = 0;
  let baselineDurationMs = 0;

  const perCase: EvalBenchmarkCaseResult[] = [];

  for (const evalCase of cases) {
    // Parse expected output once — shared by both arms.
    const { expectation, expectedRegions } = _parseExpected(evalCase.expectedOutput);

    let candidatePass: boolean | null = null;
    let baselinePass: boolean | null = null;

    // ---- Candidate arm ----
    try {
      const caseStart = Date.now();
      const candidateOutput = await harness.runSkillCase(container, skill.body, {
        inputDiff: evalCase.inputDiff,
      });
      const caseDurationMs = Date.now() - caseStart;

      const actualRegions = _findingsToRegions(candidateOutput.findings);
      const caseScore = scoring.scoreCase({ expectation, expectedRegions, actualRegions });
      const aggCase: AggregateCase = {
        name: evalCase.name,
        score: caseScore,
        expected: expectedRegions,
        actual: actualRegions,
      };
      const perCaseResult = scoring.aggregate([aggCase], {
        kept: candidateOutput.kept,
        produced: candidateOutput.produced,
      });

      // PERSIST ONLY candidate row — NEVER a baseline row (AC-23).
      await container.evalRepo.insertRun(evalCase.id, {
        batchId,
        agentVersion: skill.version,
        pass: caseScore.pass,
        recall: perCaseResult.recall,
        precision: perCaseResult.precision,
        citationAccuracy: perCaseResult.citation_accuracy,
        durationMs: caseDurationMs,
        costUsd: candidateOutput.costUsd,
        actualOutput: _buildActualOutput(
          candidateOutput.findings,
          candidateOutput.kept,
          candidateOutput.produced,
        ),
      });

      candidatePass = caseScore.pass;
      candidateSuccessCases.push(aggCase);
      candidateCostUsd += candidateOutput.costUsd ?? 0;
      candidateDurationMs += caseDurationMs;
      candidateTotalKept += candidateOutput.kept;
      candidateTotalProduced += candidateOutput.produced;
    } catch (err) {
      // Candidate LLM call fails → persist a failed candidate row; record candidatePass: null.
      // Errored cases contribute 0 cost to the batch total.
      const errMsg = err instanceof Error ? err.message : String(err);
      await container.evalRepo.insertRun(evalCase.id, {
        batchId,
        agentVersion: skill.version,
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
      candidatePass = null;
    }

    // ---- Baseline arm (NEVER persisted — AC-23) ----
    try {
      const baselineStart = Date.now();
      const baselineOutput = await harness.runSkillBaselineCase(container, {
        inputDiff: evalCase.inputDiff,
      });
      const baselineCaseDurationMs = Date.now() - baselineStart;

      const actualRegions = _findingsToRegions(baselineOutput.findings);
      const caseScore = scoring.scoreCase({ expectation, expectedRegions, actualRegions });
      const aggCase: AggregateCase = {
        name: evalCase.name,
        score: caseScore,
        expected: expectedRegions,
        actual: actualRegions,
      };

      baselinePass = caseScore.pass;
      baselineSuccessCases.push(aggCase);
      baselineCostUsd += baselineOutput.costUsd ?? 0;
      baselineDurationMs += baselineCaseDurationMs;
      baselineTotalKept += baselineOutput.kept;
      baselineTotalProduced += baselineOutput.produced;
    } catch {
      // Baseline LLM call fails → no row to persist (AC-23); record baselinePass: null.
      baselinePass = null;
    }

    perCase.push({
      case_id: evalCase.id,
      case_name: evalCase.name,
      candidate_pass: candidatePass,
      baseline_pass: baselinePass,
    });
  }

  // Pooled aggregates over successfully-scored cases only — each arm's duration_ms is its own
  // accumulated per-case wall-clock time, not the combined candidate+baseline loop time.
  const candidateResult = scoring.aggregate(
    candidateSuccessCases,
    { kept: candidateTotalKept, produced: candidateTotalProduced },
    { durationMs: candidateDurationMs, costUsd: candidateCostUsd },
  );

  const baselineResult = scoring.aggregate(
    baselineSuccessCases,
    { kept: baselineTotalKept, produced: baselineTotalProduced },
    { durationMs: baselineDurationMs, costUsd: baselineCostUsd },
  );

  // traces_total must equal ALL cases attempted (including per-case errors),
  // mirroring the traces_total override in runSkillBatch.
  const candidate: EvalBenchmark['candidate'] = {
    ...candidateResult,
    traces_total: cases.length,
  };

  const baseline: EvalBenchmark['baseline'] = {
    ...baselineResult,
    traces_total: cases.length,
  };

  return {
    candidate,
    baseline,
    delta: {
      recall: candidate.recall - baseline.recall,
      precision: candidate.precision - baseline.precision,
      citation_accuracy: candidate.citation_accuracy - baseline.citation_accuracy,
    },
    per_case: perCase,
  };
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
