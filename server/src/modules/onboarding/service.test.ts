/**
 * service.test.ts — Integration tests for OnboardingService (T15).
 *
 * Covers: AC-1, AC-2, AC-3, AC-8, AC-9, AC-13, AC-14, AC-15, AC-16, AC-19.
 *
 * Oracle: each assertion is derived from the AC's _(observable: …)_ clause in
 * SPEC-2026-07-07-onboarding-generator.md, NOT from reading the implementation.
 *
 * Pattern (server/INSIGHTS.md 2026-07-05 no-DB smoke):
 *   – Mock db (settings-only, returns model rows)
 *   – Full RepoIntel mock (all interface methods)
 *   – Injected llm mock via makeContainer
 *   – OnboardingService instantiated directly with mock repos
 *
 * No real Postgres, no real LLM, no real git clone needed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OnboardingService } from './service.js';
import type { OnboardingArtifact, LLMProvider } from '@devdigest/shared';
import { OnboardingArtifact as ArtifactSchema } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../adapters/mocks.js';
import type { RepoIntel } from '../repo-intel/types.js';
import type { Container } from '../../platform/container.js';
import type { Db } from '../../db/client.js';
import type { OnboardingRepository } from './repository.js';
import type { RepoRepository } from '../repos/repository.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'workspace-1';
const REPO_ID = '00000000-0000-0000-0000-000000000001';
const HEAD_SHA = 'abc123';
const REPO_FULL_NAME = 'testowner/testrepo';

/**
 * Top-ranked files used in the standard test setup.
 * All entries in the fixture artifact reference these paths, so the grounding
 * gate keeps them (they are in knownFiles).
 */
const KNOWN_FILES = [
  'src/index.ts',
  'src/app.ts',
  'src/db.ts',
  'src/service.ts',
  'src/routes.ts',
];

// ─── Fixtures ───────────────────────────────────────────────────────────────

const mockRepoRow = {
  id: REPO_ID,
  workspaceId: WORKSPACE_ID,
  owner: 'testowner',
  name: 'testrepo',
  fullName: REPO_FULL_NAME,
  defaultBranch: 'main',
  clonePath: null as string | null,
  lastPolledAt: null as Date | null,
  createdBy: null as string | null,
  createdAt: new Date(),
};

const makeGhLink = (file: string) =>
  `https://github.com/${REPO_FULL_NAME}/blob/${HEAD_SHA}/${file}`;

/**
 * A fully valid OnboardingArtifact that:
 *   1. Passes OnboardingArtifact.parse().
 *   2. References only files in KNOWN_FILES (survives the grounding gate).
 *   3. Has all five section types populated (AC-1 observable).
 *   4. Has 5 criticalPaths and 3 readingPath entries (happy-path minimums).
 *   5. Has 2 firstTasks entries (happy-path minimum when gaps are detected).
 */
const validArtifact: OnboardingArtifact = {
  repoName: REPO_FULL_NAME,
  filesIndexed: 10,
  generatedAt: new Date().toISOString(),
  headSha: HEAD_SHA,
  sections: {
    architecture: {
      overview: 'A layered server application with clear module boundaries.',
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
        rationale: 'Top-ranked source file "src/service.ts" has no sibling or __tests__ test file.',
        patternPointer: 'Add a sibling *.test.ts file co-located with the module.',
        complexity: 'medium',
      },
      {
        title: 'Document exported symbols in routes.ts',
        suggestedPath: 'src/routes.ts',
        gapType: 'missing_doc',
        rationale: 'Top-ranked file "src/routes.ts" has exported symbols without JSDoc/TSDoc.',
        patternPointer: 'Add JSDoc block comments above every exported function, class, and type.',
        complexity: 'low',
      },
    ],
  },
};

// ─── Mock factories ─────────────────────────────────────────────────────────

/** Build a full RepoIntel mock with overridable per-method behaviour. */
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
      filesIndexed: 10,
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

/**
 * Settings rows that configure the onboarding model.
 * Returned by getFeatureModelOverride when the workspace has a model selected.
 */
const modelSettingsRows = [
  { key: 'feature_models', value: { onboarding: { provider: 'openai', model: 'gpt-4o' } } },
];

/**
 * Build a minimal mock db sufficient for the service's getFeatureModelOverride call.
 *
 * The service (via getFeatureModelOverride) calls:
 *   db.select({key, value}).from(settings).where(eq(settings.workspaceId, workspaceId))
 *
 * All select().from().where() chains return the provided settingsRows, which is
 * fine because the service is the only caller in these tests.
 */
function makeMockDb(settingsRows: { key: string; value: unknown }[] = modelSettingsRows): Db {
  return {
    select: () => ({
      from: () => ({
        where: async () => settingsRows,
      }),
    }),
  } as unknown as Db;
}

/**
 * Build a controllable mock OnboardingRepository.
 *
 * Tracks upsert calls for cache-intact assertions.
 * Allows setting initial cached state (including headSha: null for the legacy
 * row scenario in AC-14c).
 */
function makeMockOnboardingRepo(
  initial: { artifact: OnboardingArtifact; headSha: string | null } | null = null,
) {
  const state = { stored: initial };
  const upsertCalls: Array<{ repoId: string; headSha: string }> = [];

  const repo = {
    state,
    upsertCalls,
    async read(_repoId: string) {
      return state.stored;
    },
    async upsert(repoId: string, artifact: OnboardingArtifact, headSha: string) {
      upsertCalls.push({ repoId, headSha });
      state.stored = { artifact, headSha };
    },
  };

  return repo;
}

/**
 * Build a mock Container for the OnboardingService.
 *
 * Controls:
 *   – git HEAD SHA
 *   – top-ranked files (knownFiles + gap detection inputs)
 *   – critical-path chains (for grounding knownFiles + deterministic criticalPaths)
 *   – index degradation state
 *   – LLM provider
 *   – whether the onboarding model is configured in settings
 */
function makeMockContainer(opts: {
  head?: string;
  topFiles?: string[];
  rankRows?: Array<{ path: string; percentile: number }>;
  criticalPaths?: string[][];
  isIndexDegraded?: boolean;
  llm?: LLMProvider;
  withModel?: boolean;
}): Container {
  const {
    head = HEAD_SHA,
    topFiles = KNOWN_FILES,
    rankRows,
    criticalPaths = [['src/index.ts', 'src/app.ts']],
    isIndexDegraded = false,
    llm,
    withModel = true,
  } = opts;

  const mockGit = new MockGitClient({ head });

  const defaultRankRows = topFiles.map((path, i) => ({
    path,
    percentile: (topFiles.length - i) * 10,
  }));

  const repoIntel = makeMockRepoIntel({
    getIndexState: async (repoId) => ({
      repoId,
      status: isIndexDegraded ? ('degraded' as const) : ('full' as const),
      filesIndexed: isIndexDegraded ? 0 : 10,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: head,
      indexerVersion: 1,
      updatedAt: new Date(),
    }),
    getTopFilesByRank: async () => topFiles,
    getFileRank: async () => rankRows ?? defaultRankRows,
    getCriticalPaths: async () => criticalPaths,
  });

  const settingsRows = withModel ? modelSettingsRows : [];
  const db = makeMockDb(settingsRows);

  const llmProvider = llm ?? new MockLLMProvider('openai', { structured: validArtifact });

  return {
    git: mockGit,
    repoIntel,
    llm: async () => llmProvider,
    db,
  } as unknown as Container;
}

/** Build a mock RepoRepository (only getById is needed by OnboardingService). */
function makeMockRepoRepo(row: typeof mockRepoRow | undefined = mockRepoRow) {
  return {
    getById: async (_workspaceId: string, _id: string) => row,
    // Other RepoRepository methods are never called by OnboardingService.
  };
}

/**
 * Main test-fixture factory.
 *
 * Returns the service, the LLM mock (for call-count assertions), and the
 * onboarding repo mock (for cache-intact / upsert assertions).
 */
function makeService(
  opts: {
    head?: string;
    topFiles?: string[];
    rankRows?: Array<{ path: string; percentile: number }>;
    criticalPaths?: string[][];
    isIndexDegraded?: boolean;
    llm?: MockLLMProvider;
    withModel?: boolean;
    initialCache?: { artifact: OnboardingArtifact; headSha: string | null } | null;
    repoExists?: boolean;
  } = {},
) {
  const llmMock =
    opts.llm ?? new MockLLMProvider('openai', { structured: validArtifact });

  const container = makeMockContainer({ ...opts, llm: llmMock });
  const onboardingRepo = makeMockOnboardingRepo(opts.initialCache ?? null);
  const repoRepo = makeMockRepoRepo(
    opts.repoExists === false ? undefined : mockRepoRow,
  );

  const service = new OnboardingService(
    container,
    onboardingRepo as unknown as OnboardingRepository,
    repoRepo as unknown as RepoRepository,
  );

  return { service, llmMock, onboardingRepo };
}

// ─── AC-1: returns artifact with all five sections ───────────────────────────

describe('AC-1: generation returns an artifact with all five section types populated', () => {
  it('fresh generation returns a valid artifact with all 5 sections non-empty', async () => {
    // AC-1 observable: generation request returns success with 5 non-empty sections.
    const { service } = makeService();

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    // The artifact must parse without error.
    expect(() => ArtifactSchema.parse(result)).not.toThrow();

    // All four required sections present.
    expect(result.sections.architecture.overview.length).toBeGreaterThan(0);
    expect(result.sections.criticalPaths.length).toBeGreaterThan(0);
    expect(result.sections.howToRun.length).toBeGreaterThan(0);
    expect(result.sections.readingPath.length).toBeGreaterThan(0);

    // firstTasks is present and non-empty (fixture includes 2 tasks).
    expect(result.sections.firstTasks).toBeDefined();
    expect(result.sections.firstTasks!.length).toBeGreaterThan(0);
  });
});

// ─── AC-2 + AC-3: exactly 1 LLM call per fresh generation ──────────────────

describe('AC-2 / AC-3: exactly one LLM call per fresh generation; zero during fact collection', () => {
  it('AC-2: completeStructured is called exactly once for a fresh (cache-miss) generation', async () => {
    // AC-2 observable: LLM adapter invocation count = 1 per fresh generation.
    const { service, llmMock } = makeService();

    await service.generate(WORKSPACE_ID, REPO_ID);

    const structuredCalls = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(1);
  });

  it('AC-3: total LLM calls = 1 confirms zero calls occurred during fact collection', async () => {
    // AC-3 observable: fact-collection stage records no LLM invocation.
    // The total being exactly 1 proves fact collection (which runs before the LLM
    // call) did not invoke the LLM.
    const { service, llmMock } = makeService();

    await service.generate(WORKSPACE_ID, REPO_ID);

    const allLLMCalls = llmMock.calls;
    expect(allLLMCalls).toHaveLength(1);
    expect(allLLMCalls[0]?.method).toBe('completeStructured');
  });
});

// ─── AC-8: degraded index → skeleton + degraded flag ───────────────────────

describe('AC-8: degraded index returns a skeleton with the degraded flag set', () => {
  it('degraded/un-indexed repo → artifact has degraded: true and zero LLM calls', async () => {
    // AC-8 observable: a degraded/un-indexed repo returns a skeleton with the
    // degraded flag set.
    const { service, llmMock } = makeService({ isIndexDegraded: true });

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    expect(result.degraded).toBe(true);
    expect(ArtifactSchema.safeParse(result).success).toBe(true);

    // Skeleton path skips the LLM call entirely.
    const structuredCalls = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(0);
  });

  it('degraded skeleton has all five section types present (never an empty result)', async () => {
    const { service } = makeService({ isIndexDegraded: true });

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    // Schema requires all four non-optional section keys.
    expect(result.sections).toHaveProperty('architecture');
    expect(result.sections).toHaveProperty('criticalPaths');
    expect(result.sections).toHaveProperty('howToRun');
    expect(result.sections).toHaveProperty('readingPath');
    // firstTasks is optional; the skeleton omits it — that is the expected behaviour.
  });
});

// ─── AC-9: LLM failure → skeleton + narrativeUnavailable, cache intact ──────

describe('AC-9: LLM failure returns skeleton + narrativeUnavailable; prior cache unchanged', () => {
  it('AC-9a: forced LLM error → narrativeUnavailable flag; upsert never called', async () => {
    // AC-9 observable: forced LLM error returns skeleton + flag; prior cache unchanged.
    // The MockLLMProvider throws when its fixture fails schema validation.
    const throwingLLM = new MockLLMProvider('openai', {
      structured: { broken: 'fixture-that-fails-schema' },
    });

    const { service, onboardingRepo } = makeService({ llm: throwingLLM });

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    expect(result.narrativeUnavailable).toBe(true);
    // The schema must still pass (skeleton is always valid).
    expect(ArtifactSchema.safeParse(result).success).toBe(true);
    // No upsert to the cache — prior cache left intact.
    expect(onboardingRepo.upsertCalls).toHaveLength(0);
  });

  it('AC-9b: malformed structured output (fails re-parse) → skeleton + narrativeUnavailable; cache unchanged', async () => {
    // AC-9 observable: malformed structured output failing OnboardingArtifact.parse()
    // → skeleton returned, cache unchanged.
    //
    // We use vi.spyOn to bypass MockLLMProvider's schema validation so the LLM
    // appears to "succeed" but returns an artifact whose architecture.style is an
    // invalid enum value.  The service's post-grounding re-parse then rejects it.
    const llmMock = new MockLLMProvider('openai');

    const malformedData = {
      repoName: REPO_FULL_NAME,
      filesIndexed: 10,
      generatedAt: new Date().toISOString(),
      headSha: HEAD_SHA,
      sections: {
        architecture: {
          overview: 'Overview',
          // 'INVALID_STYLE' is not in the ArchitectureStyle enum —
          // OnboardingArtifact.parse() will reject it.
          style: 'INVALID_STYLE',
          diagram: { nodes: [], edges: [] },
        },
        criticalPaths: [],
        howToRun: [],
        readingPath: [],
      },
    };

    const spy = vi.spyOn(llmMock, 'completeStructured').mockResolvedValueOnce({
      data: malformedData as unknown as OnboardingArtifact,
      model: 'gpt-4o',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: '{}',
      attempts: 1,
    });

    const { service, onboardingRepo } = makeService({ llm: llmMock });

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    // The service caught the re-parse failure and fell back to skeleton.
    expect(result.narrativeUnavailable).toBe(true);
    expect(ArtifactSchema.safeParse(result).success).toBe(true);
    // Cache must not be corrupted.
    expect(onboardingRepo.upsertCalls).toHaveLength(0);

    spy.mockRestore();
  });
});

// ─── AC-9c/d: firstTasks threading on narrativeUnavailable vs degraded paths ─

describe('AC-9c/d: firstTasks threading on LLM-failure vs degraded paths', () => {
  it(
    'AC-9c: LLM error with genuine gaps → skeleton has narrativeUnavailable: true AND non-empty firstTasks',
    async () => {
      // Finding fix: genuinely-detected firstTasks must NOT be discarded on the
      // narrativeUnavailable (LLM-error) path.
      //
      // Setup:
      //   – topFiles contains a .ts source file with no test counterpart (no real
      //     clone on disk → existingTestFiles is empty) → detectGaps finds a
      //     missing_test gap → buildFirstTasks returns { kind: 'tasks', tasks }.
      //   – The LLM mock throws (broken fixture fails schema validation inside
      //     MockLLMProvider) → service catches and builds the skeleton.
      //
      // Expected: skeleton carries narrativeUnavailable: true AND non-empty
      // sections.firstTasks (the pre-LLM detection result is preserved).
      const throwingLLM = new MockLLMProvider('openai', {
        structured: { broken: 'fixture-that-fails-schema' },
      });

      const { service } = makeService({
        llm: throwingLLM,
        topFiles: ['src/service.ts', 'src/routes.ts'],
        criticalPaths: [['src/service.ts', 'src/routes.ts']],
      });

      const result = await service.generate(WORKSPACE_ID, REPO_ID);

      expect(result.narrativeUnavailable).toBe(true);
      expect(ArtifactSchema.safeParse(result).success).toBe(true);
      // Pre-LLM gap detection found missing_test gaps → tasks must be present.
      expect(result.sections.firstTasks).toBeDefined();
      expect(result.sections.firstTasks!.length).toBeGreaterThan(0);
      // All tasks must have the required shape (AC-13: no fabrication).
      for (const task of result.sections.firstTasks!) {
        expect(task.title).toBeTruthy();
        expect(task.suggestedPath).toBeTruthy();
        expect(task.gapType).toBeTruthy();
        expect(task.rationale).toBeTruthy();
      }
    },
  );

  it(
    'AC-9d: degraded-index path omits firstTasks even when gap detection ran',
    async () => {
      // AC-13 + AC-8: on the degraded path (index absent/degraded), firstTasks
      // must remain undefined regardless of what firstTasksResult contains.
      // The reviewer recommendation is explicit: "Keep the degraded-index path
      // exactly as-is (no index ⇒ no genuine detection possible ⇒ firstTasks
      // stays undefined there)."
      //
      // topFiles is non-empty so detectGaps would find a gap — but since the
      // index is degraded, _buildSkeleton must not thread those tasks through.
      const { service } = makeService({
        isIndexDegraded: true,
        topFiles: ['src/service.ts'],
        criticalPaths: [['src/service.ts']],
      });

      const result = await service.generate(WORKSPACE_ID, REPO_ID);

      expect(result.degraded).toBe(true);
      expect(result.sections.firstTasks).toBeUndefined();
      expect(ArtifactSchema.safeParse(result).success).toBe(true);
    },
  );
});

// ─── AC-13: genuine gap detection in First tasks ────────────────────────────

describe('AC-13: genuine gap detection drives First tasks; covered fixture omits honestly', () => {
  it('AC-13a: a top-ranked source file missing a test yields non-empty First tasks', async () => {
    // AC-13 observable: a zero-gap repo omits First tasks with an honest note;
    // no invented task.  Conversely, genuine gaps yield tasks (tested here).
    //
    // With topFiles = ['src/service.ts'] (a .ts source file) and no real clone on
    // disk, the service's existingTestFiles set is empty → detectGaps finds a
    // missing_test gap.  The mock LLM fixture includes a firstTasks entry for
    // src/service.ts (which IS in knownFiles) so it survives the grounding gate.
    const { service } = makeService({
      topFiles: ['src/service.ts', 'src/routes.ts'],
      criticalPaths: [['src/service.ts', 'src/routes.ts']],
      // The LLM fixture already has firstTasks referencing src/service.ts,
      // which will be in knownFiles.
    });

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    expect(result.sections.firstTasks).toBeDefined();
    expect(result.sections.firstTasks!.length).toBeGreaterThan(0);

    // Every task must have the required shape (no fabrication).
    for (const task of result.sections.firstTasks!) {
      expect(task.title).toBeTruthy();
      expect(task.suggestedPath).toBeTruthy();
      expect(task.gapType).toBeTruthy();
      expect(task.rationale).toBeTruthy();
    }
  });

  it('AC-13b: covered fixture (no gaps) → firstTasks section absent (honest omission)', async () => {
    // AC-13 observable: a zero-gap repo omits First tasks with an honest note;
    // no invented task.
    //
    // With topFiles = [] the service collects no ranked files → detectGaps
    // returns [] → buildFirstTasks returns the omitted signal.
    // The LLM fixture also has no firstTasks field (undefined).
    const noFirstTasksArtifact: OnboardingArtifact = {
      ...validArtifact,
      sections: {
        ...validArtifact.sections,
        firstTasks: undefined,
      },
    };

    const llmMock = new MockLLMProvider('openai', { structured: noFirstTasksArtifact });

    const { service } = makeService({
      topFiles: [],
      criticalPaths: [],
      llm: llmMock,
    });

    const result = await service.generate(WORKSPACE_ID, REPO_ID);

    // The section must be absent (undefined), not an empty array.
    expect(result.sections.firstTasks).toBeUndefined();
  });
});

// ─── AC-14: cache keyed by (repoId, headSha) ────────────────────────────────

describe('AC-14: cache keyed by (repoId, headSha); NULL head_sha treated as cache miss', () => {
  it('AC-14a: 2nd request at same SHA → LLM count stays at 1 (cache hit)', async () => {
    // AC-14 observable: 2nd request at same SHA → LLM count 0.
    const { service, llmMock } = makeService();

    // First call: cache miss → LLM invoked once.
    await service.generate(WORKSPACE_ID, REPO_ID);
    const afterFirst = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    ).length;
    expect(afterFirst).toBe(1);

    // Second call: onboardingRepo.state.stored now has headSha = HEAD_SHA.
    // The service reads it and sees a cache hit → no LLM call.
    await service.generate(WORKSPACE_ID, REPO_ID);
    const afterSecond = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    ).length;
    expect(afterSecond).toBe(1); // still 1 — no new LLM call
  });

  it('AC-14b: SHA change → new LLM call (cache miss on stale headSha)', async () => {
    // AC-14 observable: request after SHA change → new LLM call.
    // Stored artifact has headSha 'old-sha' ≠ current HEAD 'abc123'.
    const { service, llmMock } = makeService({
      initialCache: { artifact: validArtifact, headSha: 'old-sha-111' },
    });

    await service.generate(WORKSPACE_ID, REPO_ID);

    const structuredCalls = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(1);
  });

  it('AC-14c: NULL head_sha (legacy row) → regenerate (cache miss)', async () => {
    // AC-14 observable (from plan): NULL head_sha legacy row → regenerate.
    // A row written before the head_sha column existed has headSha: null.
    // The service MUST treat null as a cache miss and call the LLM.
    const { service, llmMock } = makeService({
      initialCache: { artifact: validArtifact, headSha: null },
    });

    await service.generate(WORKSPACE_ID, REPO_ID);

    const structuredCalls = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(1);
  });
});

// ─── AC-15: force → LLM 1 regardless of cache ──────────────────────────────

describe('AC-15: force=true always yields a fresh LLM call, even with a valid cache entry', () => {
  it('force=true bypasses a same-SHA cache entry and calls the LLM once', async () => {
    // AC-15 observable: a forced request always yields LLM count 1.
    // The stored artifact has headSha === HEAD_SHA (would normally be a cache hit).
    const { service, llmMock } = makeService({
      initialCache: { artifact: validArtifact, headSha: HEAD_SHA },
    });

    await service.generate(WORKSPACE_ID, REPO_ID, /* force */ true);

    const structuredCalls = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(1);
  });
});

// ─── AC-16: concurrent requests → LLM 1 identical result ────────────────────

describe('AC-16: two concurrent requests for the same repo serialize to one LLM call', () => {
  it('Promise.all of two generate() calls → LLM count = 1, both results identical', async () => {
    // AC-16 observable: two parallel requests → LLM count 1, identical response.
    // Both calls share the same service instance and the in-memory per-repo lock.
    const { service, llmMock } = makeService();

    const [r1, r2] = await Promise.all([
      service.generate(WORKSPACE_ID, REPO_ID),
      service.generate(WORKSPACE_ID, REPO_ID),
    ]);

    const structuredCalls = llmMock.calls.filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(1);

    // Both callers must receive the same artifact (same reference or deep-equal).
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ─── AC-19: structured log carries costUsd ──────────────────────────────────

describe('AC-19: successful generation logs a structured line with costUsd', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('console.info is called with a JSON object containing costUsd after fresh generation', async () => {
    // AC-19 observable: a structured log line carries costUsd after each fresh generation.
    // MockLLMProvider returns costUsd = 0.001.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { service } = makeService();
    await service.generate(WORKSPACE_ID, REPO_ID);

    // Collect all console.info calls that look like our structured log.
    const generationLogs = infoSpy.mock.calls.flatMap((args) => {
      try {
        const parsed = JSON.parse(String(args[0]));
        return parsed.event === 'generation_complete' ? [parsed] : [];
      } catch {
        return [];
      }
    });

    expect(generationLogs).toHaveLength(1);
    const log = generationLogs[0]!;
    expect(log.module).toBe('onboarding');
    expect(typeof log.costUsd).toBe('number');
    expect(log.costUsd).toBeGreaterThan(0);
    expect(log.repoId).toBe(REPO_ID);
  });
});
