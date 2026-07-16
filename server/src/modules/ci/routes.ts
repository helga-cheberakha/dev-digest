/**
 * CI module routes.
 *
 *   POST /agents/:id/export-ci       → CiExport   (T3)
 *   GET  /agents/:id/ci-installations → CiInstallation[]  (T3)
 *   POST /ci-runs/refresh            → CiRun[]    (T4 — MUST be registered BEFORE /:id params)
 *   GET  /ci-runs                    → CiRun[]    (T4)
 *
 * Route registration ORDER matters: static paths (`/ci-runs/refresh`) MUST come
 * BEFORE any `/:id`-style param route to avoid Fastify matching "refresh" as a
 * UUID param (see INSIGHTS.md 2026-06-18).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput, CiExport, CiInstallation, CiRun } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CiService } from './service.js';

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------------------
  // STATIC ROUTES FIRST (before /:id param routes) — INSIGHTS.md 2026-06-18
  // ---------------------------------------------------------------------------

  // T4: POST /ci-runs/refresh — pull-based ingestion
  app.post(
    '/ci-runs/refresh',
    {
      schema: {
        response: { 200: z.array(CiRun) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.refresh(workspaceId);
    },
  );

  // T4: GET /ci-runs — list all CI runs for the workspace
  app.get(
    '/ci-runs',
    {
      schema: {
        response: { 200: z.array(CiRun) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.listCiRuns(workspaceId);
    },
  );

  // ---------------------------------------------------------------------------
  // PARAM ROUTES — registered AFTER static routes above
  // ---------------------------------------------------------------------------

  // T3: POST /agents/:id/export-ci — generate + commit CI bundle
  app.post(
    '/agents/:id/export-ci',
    {
      schema: {
        params: IdParams,
        body: CiExportInput,
        response: { 200: CiExport },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.export(workspaceId, req.params.id, req.body);
    },
  );

  // T3: GET /agents/:id/ci-installations — list installations for an agent
  app.get(
    '/agents/:id/ci-installations',
    {
      schema: {
        params: IdParams,
        response: { 200: z.array(CiInstallation) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.listInstallations(workspaceId, req.params.id);
    },
  );
}
