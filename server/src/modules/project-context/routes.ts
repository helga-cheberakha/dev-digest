/**
 * Project Context HTTP routes (T7 — AC-1, AC-2, AC-3, AC-4, AC-8).
 *
 *   GET /project-context/documents?repoId=<uuid>
 *       Stat-only discovery of .md files under specs/docs/insights in the
 *       repo's clone. Degrades to an empty list + reason when the clone is
 *       missing (AC-3); caps at 500 with truncated flag (AC-4).
 *
 *   GET /project-context/documents/preview?path=<encoded-path>
 *       Returns the raw markdown content of a single document.
 *       Path confinement (guardPath) is enforced in the service before read
 *       (AC-8). Resolves the active repo for the workspace (single-repo scan
 *       decision).
 *
 * Route paths match the client TanStack Query hooks in
 * client/src/lib/hooks/project-context.ts exactly (verified against T9).
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ValidationError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

// ---- Request schemas ----

const DiscoveryQuery = z.object({
  /** The workspace-scoped repository UUID to scan. */
  repoId: z.string().uuid(),
});

const PreviewQuery = z.object({
  /** A repo-relative path to the document (e.g. "specs/api.md"). */
  path: z.string().min(1),
});

// ---- Plugin ----

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  /**
   * Discovery: stat-only list of .md files under context root folders.
   *
   * Returns `{ documents: [], truncated: false, reason }` rather than an error
   * status when the clone is missing — the client renders an empty state (AC-3).
   */
  app.get(
    '/project-context/documents',
    { schema: { querystring: DiscoveryQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.discoverDocuments(workspaceId, req.query.repoId);
    },
  );

  /**
   * Preview: raw markdown content of a single confined document.
   *
   * Returns 422 when the path fails confinement (traversal, symlink escape,
   * wrong root folder, non-.md). The service's guardPath validation runs
   * BEFORE any file read (AC-8).
   */
  app.get(
    '/project-context/documents/preview',
    { schema: { querystring: PreviewQuery } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.previewDocument(workspaceId, req.query.path);
      if (!result.ok) {
        throw new ValidationError(result.reason);
      }
      return result.document;
    },
  );
}
