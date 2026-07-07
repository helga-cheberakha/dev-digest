import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefRepository } from './repository.js';
import { BriefService } from './service.js';

/**
 * Brief module (Why+Risk Brief).
 *
 *   POST /pulls/:id/brief  {force?: boolean}  → generate or serve the cached
 *                                              Brief (AC-1/AC-6/AC-7/AC-8).
 *                                              Body-less POST is valid (force
 *                                              defaults to false) — tolerant
 *                                              manual parse mirrors
 *                                              `reviews/routes.ts`'s
 *                                              `/pulls/:id/review`.
 *
 * No logic/DB/SDK here — everything (fact gathering, locking, the single LLM
 * call, grounding, caching) lives in `BriefService`; `NotFoundError` /
 * `ExternalServiceError` thrown by the service are AppError subclasses
 * already mapped by the global `app.setErrorHandler` to a stack-trace-free
 * `{ error: { code, message, details } }` JSON body at the error's own status
 * (404 / 502) — propagate them untouched (AC-9).
 */
const BriefRequestBody = z.object({ force: z.boolean().optional() });

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container, new BriefRepository(container.db));

  app.post('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = BriefRequestBody.parse(req.body ?? {});
    return service.generateBrief(req.params.id, workspaceId, { force: body.force });
  });
}
