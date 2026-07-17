/**
 * Transport layer — agent-performance routes.
 *
 * No DB access, no SDK calls in this file. Validates input, delegates to
 * AgentPerformanceService, and maps domain errors to HTTP status codes.
 *
 * Route-precedence note: /agents/performance (static) is registered in THIS
 * plugin; /agents/:id (parametric, agents module) lives in a separate plugin.
 * Fastify's find-my-way resolves static routes before parametric ones globally,
 * so the two do not collide. Do NOT also declare a bare /agents/:id route here.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AgentPerf, AgentStats, AgentRunHistory } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AgentPerformanceService } from './service.js';
import { resolveWindow } from './helpers.js';
import { MAX_RANGE_DAYS, RUN_HISTORY_DEFAULT_LIMIT } from './constants.js';
import { AppError } from '../../platform/errors.js';

// ---------------------------------------------------------------------------
// Query schema shared by both stats routes
// ---------------------------------------------------------------------------

/**
 * Window query parameters: period preset or custom date range.
 * Period enum is validated here. Custom-range business constraints
 * (from/to required, from <= to, range <= MAX_RANGE_DAYS) are validated in
 * the handler via validateWindowQuery — that path throws AppError (400).
 */
const WindowQuery = z.object({
  period: z.enum(['30d', '1d', 'custom']),
  from: z.string().optional(),
  to: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Business validation helper
// ---------------------------------------------------------------------------

/**
 * Validate custom-period constraints. Throws AppError (400) on violation:
 *   - from and to are required when period === 'custom'
 *   - from must not be after to
 *   - date range must not exceed MAX_RANGE_DAYS (365)
 *
 * No-ops for preset periods ('30d', '1d').
 */
function validateWindowQuery(period: string, from?: string, to?: string): void {
  if (period !== 'custom') return;

  if (!from || !to) {
    throw new AppError(
      'invalid_period',
      'from and to are required when period is custom',
      400,
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new AppError('invalid_period', 'from and to must be valid date strings', 400);
  }

  if (fromDate > toDate) {
    throw new AppError('invalid_period', 'from must not be after to', 400);
  }

  // rangeDays is the span from the start of `from` to the start of `to`.
  // resolveWindow expands to[23:59:59.999], so the effective window can be up
  // to MAX_RANGE_DAYS+1 calendar days — the check here is on calendar dates only.
  const rangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new AppError(
      'invalid_period',
      `Custom range cannot exceed ${MAX_RANGE_DAYS} days`,
      400,
    );
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default async function agentPerformanceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new AgentPerformanceService(container);

  // ---- Workspace-wide performance dashboard --------------------------------
  // Static path: /agents/performance
  app.get(
    '/agents/performance',
    { schema: { querystring: WindowQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { period, from, to } = req.query;

      validateWindowQuery(period, from, to);

      const window = resolveWindow(period, from, to);
      const result = await service.getPerformance(workspaceId, window);
      return AgentPerf.parse(result);
    },
  );

  // ---- Per-agent stats -----------------------------------------------------
  // Parametric path: /agents/:id/stats
  // NotFoundError from the service (agent not in workspace) → HTTP 404 via the
  // global AppError handler. The service message is 'Agent not found' — minimal,
  // no workspace details leaked.
  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: WindowQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { id } = req.params;
      const { period, from, to } = req.query;

      validateWindowQuery(period, from, to);

      const window = resolveWindow(period, from, to);
      const result = await service.getAgentStats(workspaceId, id, window);
      return AgentStats.parse(result);
    },
  );

  // ---- Per-agent run history -----------------------------------------------
  // Parametric path: /agents/:id/runs
  // NotFoundError from the service (agent not in workspace) → HTTP 404 (same
  // mapping as the stats route above — cross-workspace agent ids never leak rows).
  app.get(
    '/agents/:id/runs',
    {
      schema: {
        params: IdParams,
        querystring: WindowQuery.extend({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).default(RUN_HISTORY_DEFAULT_LIMIT),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { id } = req.params;
      const { period, from, to, page, limit } = req.query;

      validateWindowQuery(period, from, to);

      const window = resolveWindow(period, from, to);
      const result = await service.getAgentRuns(workspaceId, id, window, page, limit);
      return AgentRunHistory.parse(result);
    },
  );
}
