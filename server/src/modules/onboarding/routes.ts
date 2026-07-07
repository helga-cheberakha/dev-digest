import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OnboardingArtifact } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { OnboardingRepository } from './repository.js';
import { OnboardingService } from './service.js';

const RepoIdParams = z.object({ repoId: z.string().uuid() });
const GenerateBody = z.object({ force: z.boolean().optional() });

/**
 * Onboarding Tour module.
 *
 *   GET  /repos/:repoId/onboarding  → return cached artifact (no rate limit; reads are cheap)
 *   POST /repos/:repoId/onboarding  → generate / regenerate artifact (per-repo rate limit, AC-17)
 *
 * Error mapping (all via global AppError handler in app.ts):
 *   ValidationError (no model configured)  → 422  (AC-18)
 *   NotFoundError (no tour generated yet)  → 404  (GET only)
 *   @fastify/rate-limit 11th POST/min      → 429  (AC-17)
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const service = new OnboardingService(
    app.container,
    new OnboardingRepository(app.container.db),
    new RepoRepository(app.container.db),
  );

  // ---- GET: fetch cached artifact (un-throttled — reads must stay cheap) ----
  // Returns the most recently generated tour, or 404 when nothing has been
  // generated yet for this repo. The client uses this to distinguish
  // "first-visit generate state" from a real error.
  app.get(
    '/repos/:repoId/onboarding',
    {
      schema: {
        params: RepoIdParams,
        response: { 200: OnboardingArtifact },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const artifact = await service.getCached(workspaceId, req.params.repoId);
      if (!artifact) {
        throw new NotFoundError('No onboarding tour has been generated yet for this repository');
      }
      return artifact;
    },
  );

  // ---- POST: generate (or force-regenerate) artifact -------------------------
  // Per-repo rate limit (AC-17): keyed on repoId, not client IP, so 10 requests
  // per minute are counted per repo regardless of how many clients share an IP.
  // Apply ONLY to this route — the GET fetch above must remain un-throttled.
  app.post(
    '/repos/:repoId/onboarding',
    {
      schema: {
        params: RepoIdParams,
        body: GenerateBody,
        response: { 200: OnboardingArtifact },
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          // Per-repo keying (AC-17): each repo gets its own 10-req/min quota.
          // Cast needed: keyGenerator receives raw FastifyRequest where params
          // is untyped (ZodTypeProvider does not apply inside config callbacks).
          keyGenerator: (req) => (req.params as { repoId: string }).repoId,
        },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // service.generate throws ValidationError (→ 422) when no onboarding
      // model is configured (AC-18). The global AppError handler maps it.
      return service.generate(workspaceId, req.params.repoId, req.body.force);
    },
  );
}
