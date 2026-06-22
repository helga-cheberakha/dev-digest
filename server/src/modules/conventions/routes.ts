import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

const RepoIdParams = z.object({ repoId: z.string().uuid() });
const ConventionIdParams = z.object({ repoId: z.string().uuid(), id: z.string().uuid() });

const UpdateConventionBody = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  rule: z.string().min(1).optional(),
  snippet: z.string().optional(),
});

/**
 * Conventions Extractor module.
 *
 *   POST /repos/:repoId/conventions/extract  → trigger LLM extraction
 *   GET  /repos/:repoId/conventions          → list non-rejected conventions
 *   PUT  /repos/:repoId/conventions/:id      → accept / reject / edit
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  // POST /repos/:repoId/conventions/extract must be registered BEFORE
  // /repos/:repoId/conventions/:id to avoid "extract" matching the uuid param.
  app.post(
    '/repos/:repoId/conventions/extract',
    { schema: { params: RepoIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.extract(workspaceId, req.params.repoId);
      reply.status(200);
      return result;
    },
  );

  app.get(
    '/repos/:repoId/conventions',
    { schema: { params: RepoIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.repoId);
    },
  );

  app.put(
    '/repos/:repoId/conventions/:id',
    { schema: { params: ConventionIdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const convention = await service.update(
        workspaceId,
        req.params.repoId,
        req.params.id,
        req.body,
      );
      if (!convention) throw new NotFoundError('Convention not found');
      return convention;
    },
  );
}
