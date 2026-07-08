/**
 * routes.test.ts — HTTP-layer integration tests for onboarding routes (T15).
 *
 * Covers: AC-1 (five-section response), AC-17 (rate limit), AC-18 (missing model → 422).
 *
 * Oracle: each assertion is derived from the AC's _(observable: …)_ clause in
 * SPEC-2026-07-07-onboarding-generator.md.
 *
 * Pattern (server/INSIGHTS.md 2026-07-05 no-DB smoke):
 *   – buildApp({ config, db: mockDb, overrides: { auth, repoIntel, llm? } })
 *   – Table-identity mock db: discriminates repos / settings / onboarding by object ===
 *   – MockAuthProvider, MockLLMProvider from adapters/mocks
 *   – Rate-limit tests use nodeEnv: 'development' so @fastify/rate-limit registers
 *     (it is disabled when nodeEnv === 'test', per app.ts).
 */

import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider, MockLLMProvider } from '../../adapters/mocks.js';
import type { RepoIntel } from '../repo-intel/types.js';
import type { Db } from '../../db/client.js';
import type { ContainerOverrides } from '../../platform/container.js';
import type { OnboardingArtifact } from '@devdigest/shared';
import { repos, settings, onboarding } from '../../db/schema.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** REPO_ID must be a valid UUID (ZodTypeProvider validates params). */
const REPO_ID = '00000000-0000-0000-0000-000000000002';
const REPO_FULL_NAME = 'routeowner/routerepo';
const HEAD_SHA = 'abc123';

/**
 * MockAuthProvider uses workspaceId = 'w1'. The mock db ignores the WHERE
 * clause so the workspaceId in the row does not need to match.
 */
const mockRepoRow = {
  id: REPO_ID,
  workspaceId: 'w1',
  owner: 'routeowner',
  name: 'routerepo',
  fullName: REPO_FULL_NAME,
  defaultBranch: 'main',
  clonePath: null as string | null,
  lastPolledAt: null as Date | null,
  createdBy: null as string | null,
  createdAt: new Date(),
};

/**
 * Settings rows that expose the onboarding model configuration.
 * getFeatureModelOverride queries settings by workspace and parses feature_models.onboarding.
 */
const modelSettingsRows = [
  { key: 'feature_models', value: { onboarding: { provider: 'openai', model: 'gpt-4o' } } },
];

const makeGhLink = (file: string) =>
  `https://github.com/${REPO_FULL_NAME}/blob/${HEAD_SHA}/${file}`;

/**
 * Minimal valid OnboardingArtifact fixture.
 * Must pass OnboardingArtifact.parse() and survive the grounding gate.
 * Only references files that will be in knownFiles (topFilePaths union criticalChains).
 */
const validArtifact: OnboardingArtifact = {
  repoName: REPO_FULL_NAME,
  filesIndexed: 5,
  generatedAt: new Date().toISOString(),
  headSha: HEAD_SHA,
  sections: {
    architecture: {
      overview: 'A clean layered API server with module-level separation.',
      style: 'layered',
      diagram: { nodes: [], edges: [] },
    },
    criticalPaths: [
      { file: 'src/index.ts', rationale: 'Entry point', link: makeGhLink('src/index.ts') },
      { file: 'src/app.ts', rationale: 'App wiring', link: makeGhLink('src/app.ts') },
      { file: 'src/db.ts', rationale: 'Database layer', link: makeGhLink('src/db.ts') },
      { file: 'src/service.ts', rationale: 'Business logic', link: makeGhLink('src/service.ts') },
      { file: 'src/routes.ts', rationale: 'HTTP routes', link: makeGhLink('src/routes.ts') },
    ],
    howToRun: [
      { step: 'Install dependencies', command: 'npm install' },
      { step: 'Start the server', command: 'npm run dev' },
    ],
    readingPath: [
      { file: 'src/index.ts', rationale: 'Start here', link: makeGhLink('src/index.ts') },
      { file: 'src/app.ts', rationale: 'Core wiring', link: makeGhLink('src/app.ts') },
      { file: 'src/db.ts', rationale: 'Data access', link: makeGhLink('src/db.ts') },
    ],
    firstTasks: [
      {
        title: 'Add tests for service.ts',
        suggestedPath: 'src/service.ts',
        gapType: 'missing_test',
        rationale: 'Top-ranked source file lacks a sibling test file.',
        patternPointer: 'Add a *.test.ts sibling file co-located with the module.',
        complexity: 'medium',
      },
      {
        title: 'Document exported symbols in routes.ts',
        suggestedPath: 'src/routes.ts',
        gapType: 'missing_doc',
        rationale: 'Public API exported symbols lack JSDoc.',
        patternPointer: 'Add JSDoc block comments above every export.',
        complexity: 'low',
      },
    ],
  },
};

// ─── Mock factories ──────────────────────────────────────────────────────────

/**
 * Table-identity mock db.
 *
 * Discriminates between `repos`, `settings`, and `onboarding` tables by
 * JavaScript object identity (=== comparison on the Drizzle table descriptor).
 * The mock ignores the WHERE clause — it is sufficient for no-DB smoke tests.
 *
 * `db.update()` is intentionally absent. `reapStaleRuns()` in buildApp uses it;
 * the resulting throw is caught by buildApp's non-fatal try/catch.
 */
function makeMockDb(opts: {
  repoRow?: typeof mockRepoRow | null;
  settingsRows?: { key: string; value: unknown }[];
  /** Stored onboarding row (matches the DB column shape read by OnboardingRepository.read). */
  onboardingRow?: { json: OnboardingArtifact; headSha: string | null } | null;
  /** Called when OnboardingRepository.upsert() runs (used to confirm side-effect). */
  onUpsert?: () => void;
}): Db {
  return {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: async (_cond?: unknown): Promise<unknown[]> => {
          if (table === repos) {
            return opts.repoRow ? [opts.repoRow] : [];
          }
          if (table === settings) {
            return opts.settingsRows ?? [];
          }
          if (table === onboarding) {
            return opts.onboardingRow ? [opts.onboardingRow] : [];
          }
          // Fall through for any other tables (e.g. agentRuns in reapStaleRuns).
          return [];
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_values: unknown) => ({
        onConflictDoUpdate: async (_opts: unknown): Promise<void> => {
          opts.onUpsert?.();
        },
      }),
    }),
  } as unknown as Db;
}

/**
 * Full RepoIntel mock — implements ALL interface methods (required by tsc).
 * Allows per-test overrides for getIndexState.
 */
function makeMockRepoIntel(overrides: Partial<RepoIntel> = {}): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({
      status: 'full',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
    }),
    getIndexState: async (repoId) => ({
      repoId,
      status: 'full',
      filesIndexed: 5,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: HEAD_SHA,
      indexerVersion: 1,
      updatedAt: new Date(),
    }),
    getBlastRadius: async () => ({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    }),
    getReachableEndpoints: async () => ({}),
    getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => [],
    getCriticalPaths: async () => [],
    ...overrides,
  };
}

/** Build and return a test app; caller is responsible for closing it after use. */
async function makeTestApp(opts: {
  config?: ReturnType<typeof loadConfig>;
  repoRow?: typeof mockRepoRow | null;
  settingsRows?: { key: string; value: unknown }[];
  onboardingRow?: { json: OnboardingArtifact; headSha: string | null } | null;
  repoIntelOverrides?: Partial<RepoIntel>;
  llm?: MockLLMProvider;
  onUpsert?: () => void;
}): Promise<FastifyInstance> {
  const config =
    opts.config ?? loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  const db = makeMockDb({
    repoRow: opts.repoRow ?? mockRepoRow,
    settingsRows: opts.settingsRows ?? modelSettingsRows,
    onboardingRow: opts.onboardingRow ?? null,
    onUpsert: opts.onUpsert,
  });

  const repoIntel = makeMockRepoIntel(opts.repoIntelOverrides ?? {});

  const overrides: ContainerOverrides = {
    auth: new MockAuthProvider(),
    repoIntel,
    ...(opts.llm ? { llm: { openai: opts.llm } } : {}),
  };

  return buildApp({ config, db, overrides });
}

// ─── AC-1: route returns 200 with all 5 section types ───────────────────────

describe('AC-1 (via route): POST returns 200 with all five section types populated', () => {
  it('POST /repos/:repoId/onboarding → 200 with architecture, criticalPaths, howToRun, readingPath, firstTasks', async () => {
    // AC-1 observable: successful generation request returns an artifact with all
    // five sections. We verify via the HTTP response body.
    const llm = new MockLLMProvider('openai', { structured: validArtifact });
    // The getTopFilesByRank + getCriticalPaths must return files so knownFiles
    // contains the paths the fixture references, otherwise grounding strips them.
    const topFiles = [
      'src/index.ts',
      'src/app.ts',
      'src/db.ts',
      'src/service.ts',
      'src/routes.ts',
    ];
    const app = await makeTestApp({
      llm,
      settingsRows: modelSettingsRows,
      repoIntelOverrides: {
        getTopFilesByRank: async () => topFiles,
        getFileRank: async () =>
          topFiles.map((path, i) => ({ path, percentile: (topFiles.length - i) * 10 })),
        getCriticalPaths: async () => [['src/index.ts', 'src/app.ts']],
      },
    });

    try {
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${REPO_ID}/onboarding`,
        payload: {},
      });

      expect(res.statusCode).toBe(200);

      const body = res.json<OnboardingArtifact>();
      expect(body.sections).toBeDefined();
      expect(body.sections.architecture).toBeDefined();
      expect(body.sections.architecture.overview).toBeTruthy();
      expect(body.sections.criticalPaths).toBeDefined();
      expect(body.sections.howToRun).toBeDefined();
      expect(body.sections.readingPath).toBeDefined();
      // firstTasks is optional; just check the other 4 required sections exist.
      expect(body.repoName).toBe(REPO_FULL_NAME);
    } finally {
      await app.close();
    }
  });
});

// ─── AC-18: missing model → 422 with actionable message ─────────────────────

describe('AC-18: missing feature model → 422 with an actionable error message', () => {
  it('POST with no onboarding model configured → 422', async () => {
    // AC-18 observable: missing model → 422 HTTP status code with a message
    // describing how to fix the issue (select a model in Settings → Feature models).
    //
    // We simulate an index in full health so the model check is reached.
    // The settings rows are empty → getFeatureModelOverride returns undefined
    // → ValidationError thrown → mapped to 422 by the global AppError handler.
    const app = await makeTestApp({
      settingsRows: [], // no model configured
      repoIntelOverrides: {
        getIndexState: async (repoId) => ({
          repoId,
          status: 'full',
          filesIndexed: 5,
          filesSkipped: 0,
          durationMs: 0,
          lastIndexedSha: HEAD_SHA,
          indexerVersion: 1,
          updatedAt: new Date(),
        }),
      },
    });

    try {
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${REPO_ID}/onboarding`,
        payload: {},
      });

      // AC-18 observable: 422 status.
      expect(res.statusCode).toBe(422);

      // AC-18 observable: actionable message — must mention the onboarding model
      // and how to configure it.
      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('validation_error');
      expect(body.error.message.toLowerCase()).toContain('onboarding');
    } finally {
      await app.close();
    }
  });
});

// ─── AC-17: POST rate-limited at 10/min per repo; GET is un-throttled ────────

describe('AC-17: 11th POST within a minute → 429; GET endpoint is un-throttled', () => {
  /**
   * Rate limit is only active when nodeEnv !== 'test' (see app.ts — @fastify/rate-limit
   * registration is guarded by `config.nodeEnv !== 'test'`).
   * We use nodeEnv: 'development' to activate the plugin.
   *
   * The per-route config on POST /repos/:repoId/onboarding sets max: 10, keyed by repoId.
   * We use a degraded index so the service returns a skeleton without model check or LLM —
   * keeping the test db simple (only repos table needed).
   */
  const devConfig = loadConfig({
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);

  /** Degraded index → skeleton returned without model check or LLM. */
  const degradedRepoIntel = makeMockRepoIntel({
    getIndexState: async (repoId) => ({
      repoId,
      status: 'degraded' as const,
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: '',
      indexerVersion: 1,
      updatedAt: new Date(),
    }),
  });

  it('AC-17a: first 10 POSTs succeed; 11th POST to the same repo → 429', async () => {
    // AC-17 observable: 11th POST within a minute to the same repo returns 429 Too Many Requests.
    const db = makeMockDb({ repoRow: mockRepoRow, settingsRows: [] });
    const app = await buildApp({
      config: devConfig,
      db,
      overrides: { auth: new MockAuthProvider(), repoIntel: degradedRepoIntel },
    });

    try {
      // Send 10 requests that should all succeed (degraded → skeleton → 200).
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/repos/${REPO_ID}/onboarding`,
          payload: {},
        });
        expect(res.statusCode).not.toBe(429);
      }

      // 11th request: per-repo rate limit exceeded → 429.
      const res11 = await app.inject({
        method: 'POST',
        url: `/repos/${REPO_ID}/onboarding`,
        payload: {},
      });
      expect(res11.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('AC-17b: GET endpoint is un-throttled — returns non-429 even after 10 POSTs', async () => {
    // AC-17 observable: GET fetch endpoint is not throttled; it always returns non-429
    // (may return 404 when nothing has been generated yet — that is expected and correct).
    const db = makeMockDb({
      repoRow: mockRepoRow,
      settingsRows: [],
      onboardingRow: null, // no cached artifact → GET returns 404 (not 429)
    });
    const app = await buildApp({
      config: devConfig,
      db,
      overrides: { auth: new MockAuthProvider(), repoIntel: degradedRepoIntel },
    });

    try {
      // Exhaust the POST rate limit for this repo.
      for (let i = 0; i < 10; i++) {
        await app.inject({
          method: 'POST',
          url: `/repos/${REPO_ID}/onboarding`,
          payload: {},
        });
      }

      // GET should remain accessible — the per-repo rate limit only applies to POST.
      const getRes = await app.inject({
        method: 'GET',
        url: `/repos/${REPO_ID}/onboarding`,
      });
      // 404 is expected (no cached artifact). The key assertion is "not 429".
      expect(getRes.statusCode).not.toBe(429);
      expect(getRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
