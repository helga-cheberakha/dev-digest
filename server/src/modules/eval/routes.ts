import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCaseInput,
  EvalCase,
  EvalCaseListItem,
  EvalRunResult,
  EvalRun,
  EvalRunBatch,
  EvalCompare,
  EvalDashboard,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalAnalytics } from './analytics.js';
import {
  buildCaseDraftFromFinding,
  createCase,
  listCases,
  deleteCase,
  runCaseOnce,
  runBatch,
  runSkillBatch,
} from './service.js';

const AgentIdParams = z.object({ id: z.string().uuid() });
const CaseIdParams = z.object({ id: z.string().uuid() });
const FindingIdParams = z.object({ id: z.string().uuid() });
const EmptyBody = z.object({});

/**
 * Eval / CI pipeline module.
 *
 *   POST /findings/:id/eval-case            → draft a case from a finding (no DB write)
 *   POST /eval-cases                         → persist a new eval case (201)
 *   GET  /agents/:id/eval-cases             → list cases with latest-run badge data
 *   DELETE /eval-cases/:id                  → delete a case (and its run history)
 *   POST /eval-cases/:id/run                → run a single case once
 *   POST /agents/:id/eval-runs              → run all cases for an agent (batch)
 *   GET  /agents/:id/eval-batches           → batch history (newest first)
 *   GET  /agents/:id/eval-compare           → side-by-side comparison of two batches
 *   GET  /eval/dashboard                    → dashboard (per-agent or workspace-wide)
 *
 * Error mapping (via global AppError handler in app.ts):
 *   NotFoundError  → 404  (finding/case/agent not found or cross-workspace)
 *   ValidationError → 422  (missing/invalid expected_output)
 */
export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const analytics = new EvalAnalytics(app.container);

  // ---------------------------------------------------------------------------
  // POST /findings/:id/eval-case
  //
  // Build an unpersisted draft from a finding's accepted/dismissed decision.
  // NEVER persists — always a read-only preview. See service.ts invariant.
  // ---------------------------------------------------------------------------
  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: FindingIdParams,
        body: EmptyBody,
        response: { 200: EvalCaseInput },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return buildCaseDraftFromFinding(app.container, workspaceId, req.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /eval-cases
  //
  // Persist a new eval case. Returns 201 with the persisted row.
  // ---------------------------------------------------------------------------
  app.post(
    '/eval-cases',
    {
      schema: {
        body: EvalCaseInput,
        response: { 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const row = await createCase(app.container, workspaceId, req.body);
      reply.status(201);
      return {
        id: row.id,
        owner_kind: row.ownerKind,
        owner_id: row.ownerId,
        name: row.name,
        input_diff: row.inputDiff ?? '',
        input_files: row.inputFiles,
        input_meta: row.inputMeta,
        expected_output: row.expectedOutput,
        notes: row.notes,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /agents/:id/eval-cases
  //
  // List all eval cases for an agent, augmented with the latest run outcome
  // so the UI can show pass/fail badges without a second round-trip (AC-5).
  // ---------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-cases',
    {
      schema: {
        params: AgentIdParams,
        response: { 200: z.array(EvalCaseListItem) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const cases = await listCases(app.container, workspaceId, 'agent', req.params.id);
      return cases.map((c) => ({
        id: c.id,
        owner_kind: c.ownerKind,
        owner_id: c.ownerId,
        name: c.name,
        input_diff: c.inputDiff ?? '',
        input_files: c.inputFiles,
        input_meta: c.inputMeta,
        expected_output: c.expectedOutput,
        notes: c.notes,
        latest_run: c.latestRun
          ? {
              pass: c.latestRun.pass,
              recall: c.latestRun.recall,
              precision: c.latestRun.precision,
              citation_accuracy: c.latestRun.citationAccuracy,
              ran_at:
                c.latestRun.ranAt instanceof Date
                  ? c.latestRun.ranAt.toISOString()
                  : String(c.latestRun.ranAt),
            }
          : null,
      }));
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /eval-cases/:id
  //
  // Delete a case; its run history cascades via the eval_runs FK.
  // ---------------------------------------------------------------------------
  app.delete(
    '/eval-cases/:id',
    {
      schema: {
        params: CaseIdParams,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await deleteCase(app.container, workspaceId, req.params.id);
      reply.status(204);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /eval-cases/:id/run
  //
  // Run a single eval case once; generates its own batchId. Returns the
  // aggregate EvalRun metrics plus the persisted row id.
  // ---------------------------------------------------------------------------
  app.post(
    '/eval-cases/:id/run',
    {
      schema: {
        params: CaseIdParams,
        body: EmptyBody,
        response: { 200: EvalRunResult },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const r = await runCaseOnce(app.container, workspaceId, req.params.id);
      return {
        run_id: r.runId,
        case_id: r.caseId,
        result: r.result,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /agents/:id/eval-runs
  //
  // Run all eval cases for an agent in a single batch (sequential).
  // Returns the pooled aggregate EvalRun for the batch.
  // ---------------------------------------------------------------------------
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: {
        params: AgentIdParams,
        body: EmptyBody,
        response: { 200: EvalRun },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return runBatch(app.container, workspaceId, req.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /skills/:id/eval-cases
  //
  // List all eval cases for a skill, augmented with the latest run outcome
  // so the UI can show pass/fail badges without a second round-trip.
  // ---------------------------------------------------------------------------
  app.get(
    '/skills/:id/eval-cases',
    {
      schema: {
        params: AgentIdParams,
        response: { 200: z.array(EvalCaseListItem) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const cases = await listCases(app.container, workspaceId, 'skill', req.params.id);
      return cases.map((c) => ({
        id: c.id,
        owner_kind: c.ownerKind,
        owner_id: c.ownerId,
        name: c.name,
        input_diff: c.inputDiff ?? '',
        input_files: c.inputFiles,
        input_meta: c.inputMeta,
        expected_output: c.expectedOutput,
        notes: c.notes,
        latest_run: c.latestRun
          ? {
              pass: c.latestRun.pass,
              recall: c.latestRun.recall,
              precision: c.latestRun.precision,
              citation_accuracy: c.latestRun.citationAccuracy,
              ran_at:
                c.latestRun.ranAt instanceof Date
                  ? c.latestRun.ranAt.toISOString()
                  : String(c.latestRun.ranAt),
            }
          : null,
      }));
    },
  );

  // ---------------------------------------------------------------------------
  // POST /skills/:id/eval-runs
  //
  // Run all eval cases for a skill in a single batch (sequential).
  // Returns the pooled aggregate EvalRun for the batch.
  // ---------------------------------------------------------------------------
  app.post(
    '/skills/:id/eval-runs',
    {
      schema: {
        params: AgentIdParams,
        body: EmptyBody,
        response: { 200: EvalRun },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return runSkillBatch(app.container, workspaceId, req.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /agents/:id/eval-batches
  //
  // History of batch runs for an agent, newest-first.
  // ---------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-batches',
    {
      schema: {
        params: AgentIdParams,
        response: { 200: z.array(EvalRunBatch) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return analytics.history(workspaceId, req.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /agents/:id/eval-compare?a=<batchId>&b=<batchId>
  //
  // Side-by-side comparison of two batch runs for an agent.
  // `a` is the baseline; `b` is the candidate (delta = b - a).
  // ---------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-compare',
    {
      schema: {
        params: AgentIdParams,
        querystring: z.object({
          a: z.string().uuid(),
          b: z.string().uuid(),
        }),
        response: { 200: EvalCompare },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await analytics.compare(workspaceId, req.params.id, req.query.a, req.query.b);
      } catch (err) {
        // analytics.compare throws a plain Error for unknown batch ids; map to 404.
        if (err instanceof Error && /not found/i.test(err.message)) {
          throw new NotFoundError(err.message);
        }
        throw err;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /eval/dashboard[?agentId=<uuid>][?skillId=<uuid>]
  //
  // Dashboard aggregate.
  //  - With skillId:  current metrics, delta vs prev batch, trend, per-skill alert.
  //  - With agentId:  current metrics, delta vs prev batch, trend, per-agent alert.
  //  - Without either: workspace-wide recent_runs; current/delta/trend are zeroed
  //    (no single owner to aggregate — deliberate design, see analytics.ts).
  // skillId takes precedence if both are somehow provided.
  // ---------------------------------------------------------------------------
  app.get(
    '/eval/dashboard',
    {
      schema: {
        querystring: z.object({
          agentId: z.string().uuid().optional(),
          skillId: z.string().uuid().optional(),
        }),
        response: { 200: EvalDashboard },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      if (req.query.skillId) {
        return analytics.dashboard(workspaceId, 'skill', req.query.skillId);
      }
      if (req.query.agentId) {
        return analytics.dashboard(workspaceId, 'agent', req.query.agentId);
      }
      return analytics.dashboard(workspaceId, 'agent', null);
    },
  );
}
