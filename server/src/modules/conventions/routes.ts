import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
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
 *   POST  /repos/:repoId/conventions/extract  → trigger LLM extraction
 *   GET   /repos/:repoId/conventions          → list non-rejected conventions
 *   PATCH /repos/:repoId/conventions/:id      → accept / reject / edit
 *   POST  /repos/:repoId/conventions/skill    → create skill from accepted
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  const CreateSkillBody = z.object({
    name: z.string().min(1),
    description: z.string().default(''),
  });

  // Static-segment routes first so Fastify matches them before the /:id wildcard.
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

  app.post(
    '/repos/:repoId/conventions/skill',
    { schema: { params: RepoIdParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkillFromAccepted(
        workspaceId,
        req.params.repoId,
        req.body.name,
        req.body.description,
      );
      reply.status(201);
      return skill;
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

  app.patch(
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
