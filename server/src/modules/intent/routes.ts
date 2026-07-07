import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { IntentRepository } from './repository.js';
import { IntentService } from './service.js';

const PrIdParams = z.object({ id: z.string().uuid() });

/**
 * Intent Layer module.
 *
 *   POST /pulls/:id/intent  → classify / refresh PR intent (returns PrIntentRecord)
 *   GET  /pulls/:id/intent  → return stored intent, or null when not yet classified
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container, new IntentRepository(app.container.db));

  app.post(
    '/pulls/:id/intent',
    { schema: { params: PrIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const row = await service.classifyIntent(req.params.id, workspaceId);
      reply.status(200);
      return {
        pr_id: row.prId,
        summary: row.summary,
        in_scope: row.inScope,
        out_of_scope: row.outOfScope,
      };
    },
  );

  app.get(
    '/pulls/:id/intent',
    { schema: { params: PrIdParams } },
    async (req, reply) => {
      await getContext(app.container, req);
      const row = await service.getIntent(req.params.id);
      if (!row) {
        reply.status(200);
        return null;
      }
      return {
        pr_id: row.prId,
        summary: row.summary,
        in_scope: row.inScope,
        out_of_scope: row.outOfScope,
      };
    },
  );
}
