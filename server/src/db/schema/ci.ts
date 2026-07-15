import { pgTable, uuid, text, integer, timestamp, doublePrecision, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agents } from './agents';
import { workspaces } from './core';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    githubRunId: text('github_run_id'),
  },
  (t) => [
    // Partial unique index: enforces (ci_installation_id, github_run_id) uniqueness
    // only when ci_installation_id IS NOT NULL. Once an installation is deleted and
    // the FK is set to NULL (onDelete:'set null'), Postgres treats each NULL as
    // distinct — the partial index makes this intent explicit rather than leaving
    // orphaned rows unprotected by a vanished uniqueness backstop.
    uniqueIndex('ci_runs_install_run_uq')
      .on(t.ciInstallationId, t.githubRunId)
      .where(sql`ci_installation_id IS NOT NULL`),
  ],
);
