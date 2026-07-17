import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** Generation cost in USD for this run; null when the provider/price book
     *  couldn't price it (or on failed/cancelled runs) — UI shows "—", not "$0". */
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
    /** FK to the multi-agent run this individual run belongs to (nullable). */
    multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    multiAgentRunIdx: index('agent_runs_multi_agent_run_id_idx').on(t.multiAgentRunId),
    /** Serves getMostRecentDoneRunsForAgents' DISTINCT ON (agent_id) ORDER BY
     *  agent_id, ran_at DESC entirely from the index, no heap sort needed. */
    agentStatusRanAtIdx: index('agent_runs_agent_id_status_ran_at_idx').on(
      t.agentId,
      t.status,
      t.ranAt,
    ),
    /** Serves runHistory / runHistoryCount: WHERE agent_id = ? AND ran_at BETWEEN ? AND ?
     *  ORDER BY ran_at DESC — these queries deliberately omit status (all statuses included),
     *  so the (agent_id, status, ran_at) index cannot efficiently satisfy the ran_at range
     *  sort when status is unconstrained. This (agent_id, ran_at) index directly matches
     *  the actual filter+sort columns of the Run History paginated table. */
    agentRunsAgentIdRanAtIdx: index('agent_runs_agent_id_ran_at_idx').on(t.agentId, t.ranAt),
    /** Serves agent-performance's allTimeLastRunAt: WHERE workspace_id = ? AND status = 'done'
     *  GROUP BY agent_id, MAX(ran_at) — avoids a workspace-wide sequential scan. */
    workspaceStatusRanAtIdx: index('agent_runs_workspace_id_status_ran_at_idx').on(
      t.workspaceId,
      t.status,
      t.ranAt,
    ),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  /** Ordered list of agent UUIDs that participated in this run. */
  agentIds: text('agent_ids').array().notNull(),
});
