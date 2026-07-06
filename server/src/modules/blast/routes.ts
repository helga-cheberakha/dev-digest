import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { buildBlast } from './service.js';

const PrIdParams = z.object({ id: z.string().uuid() });

/**
 * Blast radius module.
 *
 *   GET /pulls/:id/blast  → deterministic impact map: which symbols changed,
 *                           who calls them, which HTTP endpoints become reachable.
 *                           Zero LLM calls — free.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/blast',
    { schema: { params: PrIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return buildBlast(app.container, workspaceId, req.params.id, req.log);
    },
  );
}
