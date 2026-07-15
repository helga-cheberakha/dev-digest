import type { Container } from '../../platform/container.js';
import type { AgentColumn, AgentEstimate, MultiAgentRun } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRunExecutor, type Logger } from '../reviews/run-executor.js';
import { MultiAgentRepository } from './repository.js';
import { computeConflicts } from './conflicts.js';
import type { AgentRow } from '../../db/rows.js';

/**
 * Application layer — multi-agent orchestration.
 *
 * launch     → create parent row + N agent_runs (FK set) → fire-and-forget executor
 * getRun     → assemble MultiAgentRun from persisted runs/reviews/findings
 * estimates  → per-agent cost/duration from most-recent done run (global)
 *
 * Cross-module boundary: imports ReviewRunExecutor and uses container.reviewRepo
 * exactly as ReviewService.runReview does (sanctioned in plan R2).
 */
export class MultiAgentService {
  private readonly repo: MultiAgentRepository;

  constructor(private readonly container: Container) {
    this.repo = new MultiAgentRepository(container.db);
  }

  /**
   * Launch a multi-agent review:
   *   1. Validate PR + repo exist.
   *   2. Resolve each agentId to an agent row.
   *   3. Insert the multi_agent_runs parent row.
   *   4. Insert N agent_runs rows with multiAgentRunId FK set.
   *   5. Fire-and-forget ReviewRunExecutor (same pattern as ReviewService.runReview).
   *   6. Return { id, run_ids } immediately.
   */
  async launch(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{ id: string; run_ids: string[] }> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Resolve agents — fail fast if any id is unknown or not in this workspace.
    const resolvedAgents: AgentRow[] = [];
    for (const agentId of agentIds) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError(`Agent ${agentId} not found`);
      resolvedAgents.push(agent);
    }

    // Create the multi_agent_runs parent row + its N agent_runs rows (FK set)
    // in a single transaction — a partial failure can't orphan the parent.
    // Rows are created BEFORE handing off to the executor (it expects them to
    // already exist — mirrors ReviewService.runReview).
    const { id: parentId, run_ids } = await this.repo.createRunWithAgentRuns(
      { workspaceId, prId, agentIds },
      resolvedAgents.map((agent) => ({
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
      })),
    );
    const jobs: { agent: AgentRow; runId: string }[] = resolvedAgents.map((agent, i) => ({
      agent,
      runId: run_ids[i]!,
    }));

    // Fire-and-forget: mirrors ReviewService.runReview exactly.
    const executor = new ReviewRunExecutor(
      this.container,
      this.container.reviewRepo,
      this.container.agentsRepo,
    );
    void executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error(
        { prId, err: (err as Error).message },
        'multi-agent: background execution crashed',
      );
    });

    return { id: parentId, run_ids };
  }

  /**
   * Assemble a full MultiAgentRun from persisted data.
   * A failed individual agent run produces a column with status:'failed'
   * WITHOUT throwing or failing the whole read (best-effort enrichment pattern).
   */
  async getRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const parent = await this.repo.getParentRun(workspaceId, id);
    if (!parent) throw new NotFoundError('Multi-agent run not found');

    const associatedRuns = await this.repo.getAssociatedRuns(id);
    const runIds = associatedRuns.map((r) => r.run.id);
    const reviewsWithFindings = await this.repo.getReviewsForRuns(runIds);

    // Build a lookup: run_id → { review, findings }
    const reviewByRunId = new Map(
      reviewsWithFindings.map((rwf) => [rwf.review.runId, rwf]),
    );

    // Build AgentColumn[] — failed runs produce a column; no throw on failure.
    const columns: AgentColumn[] = associatedRuns.map(({ run, agentName }) => {
      const reviewData = run.id ? reviewByRunId.get(run.id) : undefined;
      const findings = reviewData?.findings ?? [];

      return {
        run_id: run.id,
        agent_id: run.agentId ?? '',
        agent_name: agentName ?? '',
        provider: run.provider,
        model: run.model,
        status: (run.status as 'done' | 'failed' | 'running') ?? 'running',
        verdict: reviewData?.review.verdict ?? null,
        score: reviewData?.review.score ?? null,
        summary: reviewData?.review.summary ?? null,
        duration_ms: run.durationMs,
        cost_usd: run.costUsd,
        findings: findings.map((f) => ({
          id: f.id,
          severity: f.severity as AgentColumn['findings'][number]['severity'],
          category: f.category,
          title: f.title,
          file: f.file,
          start_line: f.startLine,
          kind: f.kind,
        })),
      };
    });

    const conflicts = computeConflicts(columns);

    // total_cost_usd = SUM of non-null costs; null when ALL columns have null cost.
    const costValues = columns.map((c) => c.cost_usd).filter((v): v is number => v !== null);
    const total_cost_usd = costValues.length > 0 ? costValues.reduce((a, b) => a + b, 0) : null;

    // total_duration_ms = MAX of non-null durations (NOT sum — parallel execution).
    // Default 0 when no column has a recorded duration yet.
    const durationValues = columns
      .map((c) => c.duration_ms)
      .filter((v): v is number => v !== null);
    const total_duration_ms = durationValues.length > 0 ? Math.max(...durationValues) : 0;

    return {
      id: parent.id,
      pr_id: parent.prId,
      pr_number: parent.prNumber ?? null,
      ran_at: parent.ranAt.toISOString(),
      agent_count: parent.agentIds.length,
      total_duration_ms,
      total_cost_usd,
      columns,
      conflicts,
    };
  }

  /**
   * Per-agent cost/duration estimates from the single most-recent done run
   * (global across all PRs and workspaces).
   * est_duration_ms and est_cost_usd are null when the agent has zero prior
   * completed runs — no fabricated numbers, no averaging.
   *
   * Degrades to an empty/null-estimate result rather than throwing
   * (best-effort enrichment convention).
   */
  async estimates(workspaceId: string): Promise<AgentEstimate[]> {
    const agentList = await this.container.agentsRepo.listEnabled(workspaceId);
    if (agentList.length === 0) return [];

    const agentIds = agentList.map((a) => a.id);

    let mostRecentRuns: Awaited<
      ReturnType<MultiAgentRepository['getMostRecentDoneRunsForAgents']>
    >;
    try {
      mostRecentRuns = await this.repo.getMostRecentDoneRunsForAgents(agentIds);
    } catch {
      // Best-effort: return null estimates rather than throw
      mostRecentRuns = [];
    }

    const runByAgentId = new Map(mostRecentRuns.map((r) => [r.agentId, r]));

    return agentList.map((agent) => {
      const run = runByAgentId.get(agent.id);
      return {
        agent_id: agent.id,
        est_duration_ms: run?.durationMs ?? null,
        est_cost_usd: run?.costUsd ?? null,
        last_run_summary: run?.reviewSummary ?? null,
      };
    });
  }
}
