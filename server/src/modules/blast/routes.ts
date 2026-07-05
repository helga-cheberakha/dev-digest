import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { getPrFiles } from '../reviews/repository/pull.repo.js';
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
      const [pr] = await app.container.db
        .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
        .from(t.pullRequests)
        .where(
          and(
            eq(t.pullRequests.workspaceId, workspaceId),
            eq(t.pullRequests.id, req.params.id),
          ),
        );
      if (!pr) throw new NotFoundError('Pull request not found');
      const files = await getPrFiles(app.container.db, pr.id);
      const changedFiles = files.map((f) => f.path);
      return buildBlast(app.container, pr.repoId, changedFiles);
    },
  );
}
