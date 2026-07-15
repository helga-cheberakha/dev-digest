import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MultiAgentRunRequest, MultiAgentRun, AgentEstimate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentService } from './service.js';

/**
 * multi-agent module.
 *   POST  /pulls/:id/multi-agent-run   {agent_ids: string[]} → launch + return { id, run_ids }
 *   GET   /multi-agent-runs/:id                              → assembled MultiAgentRun
 *   GET   /agent-estimates                                   → AgentEstimate[] (pre-run cost/duration)
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  // ---- Launch a multi-agent review run ------------------------------------
  // Tight per-route rate limit: each call fans out to multiple expensive LLM runs.
  // Mirrors the reviews module's POST /pulls/:id/review limit.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: {
        params: IdParams,
        body: MultiAgentRunRequest,
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.launch(
        workspaceId,
        req.params.id,
        req.body.agent_ids,
        req.log,
      );
      return result;
    },
  );

  // ---- Read a multi-agent run (assembled from persisted columns) ----------
  app.get(
    '/multi-agent-runs/:id',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // Response validated against MultiAgentRun at caller level;
      // parse here to surface contract mismatches immediately in dev/test.
      const run = await service.getRun(workspaceId, req.params.id);
      return MultiAgentRun.parse(run);
    },
  );

  // ---- Pre-run estimates (cost/duration from historical runs) -------------
  app.get('/agent-estimates', {}, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const estimates = await service.estimates(workspaceId);
    return estimates.map((e) => AgentEstimate.parse(e));
  });
}
