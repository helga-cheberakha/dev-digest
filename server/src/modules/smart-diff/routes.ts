import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { buildSmartDiff } from './service.js';

const PrIdParams = z.object({ id: z.string().uuid() });

/**
 * Smart Diff module.
 *
 *   GET /pulls/:id/smart-diff  → classify PR files into core/wiring/boilerplate,
 *                                overlay findings from the latest review.
 *                                No LLM call — deterministic + free.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: PrIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const [pr] = await app.container.db
        .select({ id: t.pullRequests.id })
        .from(t.pullRequests)
        .where(
          and(
            eq(t.pullRequests.workspaceId, workspaceId),
            eq(t.pullRequests.id, req.params.id),
          ),
        );
      if (!pr) throw new NotFoundError('Pull request not found');
      return buildSmartDiff(app.container.db, pr.id);
    },
  );
}
