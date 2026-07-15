/**
 * Multi-agent service integration tests.
 *
 * These tests require Docker (Testcontainers/Postgres+pgvector).
 * They self-skip when Docker is not available (CI/sandbox without a daemon).
 * Naming convention: *.it.test.ts = DB-backed, matched by `pnpm test`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MultiAgentService } from './service.js';
import { Container } from '../../platform/container.js';
import { loadConfig } from '../../platform/config.js';
import { MockGitClient, MockGitHubClient } from '../../adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[multi-agent] Docker not available — skipping integration tests.');
}

d('MultiAgentService — integration (real Postgres)', () => {
  let pg: PgFixture;
  let container: Container;
  let service: MultiAgentService;

  // Test-scope identifiers — isolated workspace per suite run
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  let agentId1: string;
  let agentId2: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: seedWsId } = await seed(pg.handle.db);
    workspaceId = seedWsId;

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    container = new Container(config, pg.handle.db, {
      git: new MockGitClient(),
      github: new MockGitHubClient(),
    });
    service = new MultiAgentService(container);

    // Insert a test repo
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'test-owner', name: 'test-repo', fullName: 'test-owner/test-repo' })
      .returning();
    repoId = repo!.id;

    // Insert a test PR
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1,
        title: 'Test PR',
        author: 'tester',
        branch: 'feature/test',
        base: 'main',
        headSha: 'abc123',
        status: 'open',
      })
      .returning();
    prId = pr!.id;

    // Insert two test agents
    const [agent1] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Test Agent 1',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'You are a reviewer.',
        enabled: true,
      })
      .returning();
    agentId1 = agent1!.id;

    const [agent2] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Test Agent 2',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        systemPrompt: 'You are a reviewer.',
        enabled: true,
      })
      .returning();
    agentId2 = agent2!.id;
  });

  afterAll(async () => {
    // Cascade: workspaces → everything else
    if (workspaceId) {
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, workspaceId));
    }
    await pg?.stop();
  });

  // --------------------------------------------------------------------------

  it('launch creates exactly ONE multi_agent_runs row and N agent_runs with the FK set', async () => {
    const result = await service.launch(workspaceId, prId, [agentId1, agentId2]);

    expect(result.id).toBeTruthy();
    expect(result.run_ids).toHaveLength(2);

    // Verify the parent row
    const parentRows = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, result.id));
    expect(parentRows).toHaveLength(1);
    expect(parentRows[0]!.workspaceId).toBe(workspaceId);
    expect(parentRows[0]!.prId).toBe(prId);
    expect(parentRows[0]!.agentIds).toEqual([agentId1, agentId2]);

    // Verify the child agent_runs rows carry the FK
    const childRows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, result.id));
    expect(childRows).toHaveLength(2);
    const childIds = childRows.map((r) => r.id).sort();
    const expectedIds = result.run_ids.slice().sort();
    expect(childIds).toEqual(expectedIds);

    for (const row of childRows) {
      expect(row.multiAgentRunId).toBe(result.id);
      expect(row.prId).toBe(prId);
      expect(row.workspaceId).toBe(workspaceId);
      expect(row.status).toBe('running');
    }
  });

  it('getRun: total_cost_usd is SUM and total_duration_ms is MAX (not sum)', async () => {
    // Create a parent run row directly (skip service.launch to avoid executor)
    const [parent] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId, agentIds: [agentId1, agentId2] })
      .returning();
    const parentId = parent!.id;

    // Insert two DONE agent runs with known cost/duration
    const [run1] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentId1,
        prId,
        multiAgentRunId: parentId,
        status: 'done',
        durationMs: 1000,
        costUsd: 0.01,
        tokensIn: 100,
        tokensOut: 50,
        findingsCount: 0,
        grounding: '0/0 passed',
        source: 'local',
      })
      .returning();

    const [run2] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentId2,
        prId,
        multiAgentRunId: parentId,
        status: 'done',
        durationMs: 3000,
        costUsd: 0.02,
        tokensIn: 200,
        tokensOut: 100,
        findingsCount: 0,
        grounding: '0/0 passed',
        source: 'local',
      })
      .returning();

    // Insert minimal reviews for each run (needed so review data is accessible)
    await pg.handle.db.insert(t.reviews).values({
      workspaceId,
      prId,
      agentId: agentId1,
      runId: run1!.id,
      kind: 'review',
      verdict: null,
      summary: 'Summary from agent 1',
      score: null,
      model: 'gpt-4o',
    });
    await pg.handle.db.insert(t.reviews).values({
      workspaceId,
      prId,
      agentId: agentId2,
      runId: run2!.id,
      kind: 'review',
      verdict: null,
      summary: 'Summary from agent 2',
      score: null,
      model: 'claude-3-5-sonnet-20241022',
    });

    const multiRun = await service.getRun(workspaceId, parentId);

    // total_cost_usd = SUM(0.01 + 0.02) = 0.03
    expect(multiRun.total_cost_usd).toBeCloseTo(0.03, 5);

    // total_duration_ms = MAX(1000, 3000) = 3000, NOT sum (4000)
    expect(multiRun.total_duration_ms).toBe(3000);
    expect(multiRun.total_duration_ms).not.toBe(4000);

    expect(multiRun.columns).toHaveLength(2);
    expect(multiRun.id).toBe(parentId);
    expect(multiRun.pr_id).toBe(prId);
  });

  it('getRun: a failed agent run produces a column with status "failed" without breaking the read', async () => {
    const [parent] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId, agentIds: [agentId1, agentId2] })
      .returning();
    const parentId = parent!.id;

    // One done run, one failed run
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentId1,
      prId,
      multiAgentRunId: parentId,
      status: 'done',
      durationMs: 1500,
      costUsd: 0.005,
      tokensIn: 50,
      tokensOut: 25,
      findingsCount: 0,
      grounding: '0/0 passed',
      source: 'local',
    });

    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentId2,
      prId,
      multiAgentRunId: parentId,
      status: 'failed',
      durationMs: 100,
      costUsd: null,
      tokensIn: 0,
      tokensOut: 0,
      findingsCount: 0,
      grounding: '0/0 passed',
      error: 'LLM timeout',
      source: 'local',
    });

    // getRun must NOT throw; must include both columns
    const multiRun = await service.getRun(workspaceId, parentId);

    expect(multiRun.columns).toHaveLength(2);

    const failedCol = multiRun.columns.find((c) => c.status === 'failed');
    const doneCol = multiRun.columns.find((c) => c.status === 'done');

    expect(failedCol).toBeDefined();
    expect(doneCol).toBeDefined();

    // total_cost_usd: null for the failed run contributes 0 (null filtered out),
    // so it equals the done run's cost only
    expect(multiRun.total_cost_usd).toBeCloseTo(0.005, 5);

    // total_duration_ms = MAX(1500, 100) = 1500
    expect(multiRun.total_duration_ms).toBe(1500);
  });

  it('estimates: agent with zero prior done runs returns null for both fields', async () => {
    // Create a fresh isolated workspace so there are no prior runs for these agents
    const [freshWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `estimates-test-${randomUUID()}` })
      .returning();
    const freshWsId = freshWs!.id;

    try {
      const [freshAgent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId: freshWsId,
          name: 'Fresh Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'Fresh reviewer.',
          enabled: true,
        })
        .returning();

      const estimates = await service.estimates(freshWsId);

      expect(estimates).toHaveLength(1);
      expect(estimates[0]!.agent_id).toBe(freshAgent!.id);
      // Zero prior runs → both estimate fields null
      expect(estimates[0]!.est_duration_ms).toBeNull();
      expect(estimates[0]!.est_cost_usd).toBeNull();
    } finally {
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, freshWsId));
    }
  });

  it('estimates: agent with a done run returns its actual duration and cost', async () => {
    // Use the shared workspace; add a done agent_run for agentId1
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentId1,
      prId,
      status: 'done',
      durationMs: 2500,
      costUsd: 0.015,
      tokensIn: 150,
      tokensOut: 75,
      findingsCount: 1,
      grounding: '1/1 passed',
      source: 'local',
    });

    const estimates = await service.estimates(workspaceId);
    const agent1Estimate = estimates.find((e) => e.agent_id === agentId1);

    expect(agent1Estimate).toBeDefined();
    // The most-recent done run for agent1 must be surfaced; we can't guarantee
    // WHICH of the runs created in this suite is newest, but all are non-null.
    expect(agent1Estimate!.est_duration_ms).not.toBeNull();
    expect(agent1Estimate!.est_cost_usd).not.toBeNull();
  });

  it('getLatestRun: returns the most recent parent run for a PR, or null when none exist', async () => {
    // A different PR (no multi-agent runs yet) — must return null, not throw.
    const [otherPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 999,
        title: 'no runs yet',
        author: 'x',
        branch: 'x',
        base: 'main',
        headSha: 'x',
      })
      .returning();
    expect(await service.getLatestRun(workspaceId, otherPr!.id)).toBeNull();

    // Two parent runs for `prId`, seconds apart — getLatestRun must surface the newer one.
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId, agentIds: [agentId1], ranAt: older });
    const [parent2] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId, agentIds: [agentId1, agentId2], ranAt: newer })
      .returning();

    const latest = await service.getLatestRun(workspaceId, prId);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(parent2!.id);
    expect(latest!.agent_count).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Fixture generation: produces the golden JSON files used by the schema-drift
  // guard (see __fixtures__/*.fixture.json, validated statically and without
  // Docker by fixture.test.ts). SKIPPED by default — these write real
  // (UUID/timestamp-bearing) DB output over the *committed* fixture files, so
  // running them on every `npm test` would silently regenerate the "golden"
  // fixtures with different values each time (new random IDs), defeating the
  // whole point of a stable, byte-identical drift guard the client tests copy.
  // Un-skip and run this file alone (`npx vitest run service.it.test.ts`) only
  // when you intend to deliberately regenerate the fixtures (e.g. the
  // MultiAgentRun/AgentEstimate contract shape changed) — then re-`skip` and
  // copy the two files byte-identical into both client __fixtures__ dirs.
  // --------------------------------------------------------------------------

  it.skip('fixture: multi-agent-run with done+failed columns and conflict with ignored take', async () => {
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
    mkdirSync(fixturesDir, { recursive: true });

    // Parent multi_agent_runs row
    const [parent] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId, agentIds: [agentId1, agentId2] })
      .returning();
    const parentId = parent!.id;

    // Done agent_run for agent1 (has findings → source of the conflict)
    const [run1] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentId1,
        prId,
        multiAgentRunId: parentId,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4o',
        durationMs: 2800,
        costUsd: 0.012,
        tokensIn: 350,
        tokensOut: 180,
        findingsCount: 1,
        grounding: '1/1 passed',
        source: 'local',
      })
      .returning();

    // Failed agent_run for agent2 (no findings → gets 'ignored' take in the conflict)
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agentId2,
      prId,
      multiAgentRunId: parentId,
      status: 'failed',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      durationMs: 150,
      costUsd: null,
      tokensIn: 0,
      tokensOut: 0,
      findingsCount: 0,
      grounding: '0/0 passed',
      error: 'LLM timeout after 30s',
      source: 'local',
    });

    // Review for agent1's done run
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: agentId1,
        runId: run1!.id,
        kind: 'review',
        verdict: 'REQUEST_CHANGES',
        summary: 'Found a potential null dereference in the auth handler.',
        score: 75,
        model: 'gpt-4o',
      })
      .returning();

    // One finding: agent1 flagged src/auth/handler.ts:42, agent2 did not → 'ignored' take
    await pg.handle.db.insert(t.findings).values({
      reviewId: review!.id,
      file: 'src/auth/handler.ts',
      startLine: 42,
      endLine: 44,
      severity: 'WARNING',
      category: 'bug',
      title: 'Possible null dereference on user.session',
      rationale: 'user.session could be undefined when the session has expired.',
      suggestion: 'Add a null check before accessing user.session.token.',
      confidence: 0.85,
      kind: 'finding',
    });

    const multiRun = await service.getRun(workspaceId, parentId);

    // Assert required shape properties before serializing
    expect(multiRun.columns).toHaveLength(2);
    expect(multiRun.columns.some((c) => c.status === 'failed')).toBe(true);
    expect(multiRun.columns.some((c) => c.status === 'done')).toBe(true);
    expect(multiRun.conflicts).toHaveLength(1);
    expect(multiRun.conflicts[0]!.takes.some((take) => take.verdict === 'ignored')).toBe(true);

    writeFileSync(
      join(fixturesDir, 'multi-agent-run.fixture.json'),
      JSON.stringify(multiRun, null, 2),
      'utf-8',
    );
  });

  it.skip('fixture: agent-estimates with one warmed agent and one cold-start agent', async () => {
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
    mkdirSync(fixturesDir, { recursive: true });

    // Isolated workspace so prior run history is clean
    const [freshWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `est-fixture-${randomUUID()}` })
      .returning();
    const freshWsId = freshWs!.id;

    try {
      // Warmed agent — will have a done run
      const [warmedAgent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId: freshWsId,
          name: 'GPT-4o Reviewer',
          provider: 'openai',
          model: 'gpt-4o',
          systemPrompt: 'You are a precise code reviewer.',
          enabled: true,
        })
        .returning();

      // Cold-start agent — zero done runs → both estimates null
      await pg.handle.db.insert(t.agents).values({
        workspaceId: freshWsId,
        name: 'Claude Sonnet Reviewer',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        systemPrompt: 'You are a thorough code reviewer.',
        enabled: true,
      });

      // A repo + PR for the warmed agent's done run
      const [freshRepo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId: freshWsId, owner: 'acme', name: 'api', fullName: 'acme/api' })
        .returning();
      const [freshPr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId: freshWsId,
          repoId: freshRepo!.id,
          number: 1,
          title: 'Add auth middleware',
          author: 'alice',
          branch: 'feat/auth',
          base: 'main',
          headSha: 'aabbcc11',
          status: 'open',
        })
        .returning();

      // Done agent_run for the warmed agent only
      await pg.handle.db.insert(t.agentRuns).values({
        workspaceId: freshWsId,
        agentId: warmedAgent!.id,
        prId: freshPr!.id,
        status: 'done',
        durationMs: 3100,
        costUsd: 0.018,
        tokensIn: 420,
        tokensOut: 210,
        findingsCount: 2,
        grounding: '2/2 passed',
        source: 'local',
      });

      const estimates = await service.estimates(freshWsId);

      expect(estimates).toHaveLength(2);
      const warmed = estimates.find((e) => e.agent_id === warmedAgent!.id);
      const cold = estimates.find((e) => e.agent_id !== warmedAgent!.id);
      expect(warmed!.est_duration_ms).not.toBeNull();
      expect(warmed!.est_cost_usd).not.toBeNull();
      expect(cold!.est_duration_ms).toBeNull();
      expect(cold!.est_cost_usd).toBeNull();

      writeFileSync(
        join(fixturesDir, 'agent-estimates.fixture.json'),
        JSON.stringify(estimates, null, 2),
        'utf-8',
      );
    } finally {
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, freshWsId));
    }
  });
});
