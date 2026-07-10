/**
 * service.test.ts — Unit tests for eval/service.ts (T5).
 *
 * Covers (spec IDs from task T5 acceptance criteria):
 *  (a) buildCaseDraftFromFinding — accepted → must_find, dismissed → must_not_flag;
 *      zero eval_cases rows created.
 *  (b) createCase — actually persists and returns the row.
 *  (c) cross-workspace findingId → 404 NotFoundError.
 *  (d) runBatch on zero cases → traces_total: 0, zero eval_runs rows.
 *  (e) mid-batch throw on case 2-of-3 → rows for 1 and 3 (scored), row for 2
 *      (failed), batch does not abort.
 *  (f) malformed expected_output passed to createCase → ValidationError, no row.
 *  (g) runBatch over N cases → N rows all sharing one identical batchId and
 *      agentVersion.
 *
 * Pattern: vi.mock('./run.js') to control runCase return values without a real
 * LLM; container dependencies stubbed as plain objects cast to Container.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must appear before the import of service.ts so Vitest hoists it.
vi.mock('./run.js', () => ({
  runCase: vi.fn(),
}));

// Import after mock registration.
import * as runModule from './run.js';
import {
  buildCaseDraftFromFinding,
  createCase,
  listCases,
  runBatch,
} from './service.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_WS = 'aaaaaaaa-0000-0000-0000-000000000002';
const FINDING_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const REVIEW_ID = 'cccccccc-0000-0000-0000-000000000001';
const PULL_ID = 'dddddddd-0000-0000-0000-000000000001';
const AGENT_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const CASE_ID = 'ffffffff-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FindingFixture {
  id: string;
  reviewId: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
  rationale: string;
  suggestion: string;
  confidence: number;
  kind: string;
  trifectaComponents: null;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

function makeAcceptedFinding(overrides: Partial<FindingFixture> = {}): FindingFixture {
  return {
    id: FINDING_ID,
    reviewId: REVIEW_ID,
    file: 'src/auth.ts',
    startLine: 42,
    endLine: 50,
    severity: 'WARNING',
    category: 'security',
    title: 'Missing rate limit',
    rationale: 'could be brute-forced',
    suggestion: 'add rate limiting',
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: new Date('2026-01-01'),
    dismissedAt: null,
    ...overrides,
  };
}

function makeDismissedFinding(overrides: Partial<ReturnType<typeof makeAcceptedFinding>> = {}) {
  return makeAcceptedFinding({
    acceptedAt: null,
    dismissedAt: new Date('2026-01-01'),
    ...overrides,
  });
}

function makeUndecidedFinding(overrides: Partial<ReturnType<typeof makeAcceptedFinding>> = {}) {
  return makeAcceptedFinding({
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  });
}

const BASE_REVIEW = {
  id: REVIEW_ID,
  workspaceId: WS,
  prId: PULL_ID,
  agentId: AGENT_ID,
  runId: null,
  kind: 'review' as const,
  verdict: 'comment',
  summary: 'looks ok',
  score: 80,
  model: 'gpt-4',
  createdAt: new Date('2026-01-01'),
};

const BASE_PULL = {
  id: PULL_ID,
  workspaceId: WS,
  repoId: 'repo-1',
  number: 42,
  title: 'My PR',
  author: 'alice',
  branch: 'feat/x',
  base: 'main',
  headSha: 'abc123',
  lastReviewedSha: null,
  additions: 10,
  deletions: 5,
  filesCount: 2,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
};

const BASE_AGENT = {
  id: AGENT_ID,
  workspaceId: WS,
  name: 'Test Agent',
  description: null,
  systemPrompt: 'You are a reviewer.',
  model: 'gpt-4o-mini',
  provider: 'openai',
  strategy: 'single-pass',
  enabled: true,
  version: 3,
  createdAt: new Date('2026-01-01'),
};

function makeCase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: WS,
    ownerKind: 'agent' as const,
    ownerId: AGENT_ID,
    name: `Case ${id}`,
    inputDiff: '',
    inputFiles: null,
    inputMeta: null,
    expectedOutput: { expectation: 'must_find', regions: [] },
    notes: null,
    ...overrides,
  };
}

// Mock finding from runCase (empty → scores as pass with no expected regions)
const MOCK_RUN_OUTPUT = { findings: [], kept: 0, produced: 0 };

// ---------------------------------------------------------------------------
// Container factory helpers
// ---------------------------------------------------------------------------

type FindingContextResult =
  | { finding: ReturnType<typeof makeAcceptedFinding>; review: typeof BASE_REVIEW; pull: typeof BASE_PULL }
  | undefined;

function makeContainer(opts: {
  findingContext?: () => Promise<FindingContextResult>;
  getPrFiles?: () => Promise<{ path: string; patch: string | null }[]>;
  insertCase?: (values: unknown) => Promise<Record<string, unknown>>;
  listCases?: () => Promise<ReturnType<typeof makeCase>[]>;
  getCase?: () => Promise<ReturnType<typeof makeCase> | undefined>;
  insertRun?: (caseId: string, values: unknown) => Promise<Record<string, unknown>>;
  latestRunPerCase?: () => Promise<unknown[]>;
  getById?: () => Promise<typeof BASE_AGENT | undefined>;
  linkedSkills?: () => Promise<unknown[]>;
} = {}): Container {
  return {
    reviewRepo: {
      findingContext: opts.findingContext ?? (async () => undefined),
      getPrFiles: opts.getPrFiles ?? (async () => []),
    },
    evalRepo: {
      insertCase: opts.insertCase ?? (async (values: unknown) => ({ id: 'new-case-1', ...values as object })),
      listCases: opts.listCases ?? (async () => []),
      getCase: opts.getCase ?? (async () => undefined),
      insertRun: opts.insertRun ?? (async (caseId: string, values: unknown) => ({ id: `run-${caseId}`, caseId, ...values as object })),
      latestRunPerCase: opts.latestRunPerCase ?? (async () => []),
    },
    agentsRepo: {
      getById: opts.getById ?? (async () => BASE_AGENT),
      linkedSkills: opts.linkedSkills ?? (async () => []),
    },
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// (a) buildCaseDraftFromFinding: accepted → must_find, dismissed → must_not_flag
//     ZERO eval_cases rows created.
// ---------------------------------------------------------------------------

describe('(a) buildCaseDraftFromFinding', () => {
  let insertCaseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    insertCaseSpy = vi.fn();
  });

  it('accepted finding → expectation: must_find, zero eval_cases rows', async () => {
    const finding = makeAcceptedFinding();
    const container = makeContainer({
      findingContext: async () => ({ finding, review: BASE_REVIEW, pull: BASE_PULL }),
      getPrFiles: async () => [{ path: 'src/auth.ts', patch: '--- a/src/auth.ts\n+++ b/src/auth.ts\n' }],
      insertCase: insertCaseSpy,
    });

    const draft = await buildCaseDraftFromFinding(container, WS, FINDING_ID);

    expect((draft.expected_output as { expectation: string }).expectation).toBe('must_find');
    expect(draft.name).toBe(finding.title);
    expect(draft.owner_id).toBe(AGENT_ID);
    expect(draft.owner_kind).toBe('agent');
    expect(draft.input_meta).toEqual({ source_finding_id: FINDING_ID });
    // INVARIANT: insertCase must NEVER have been called
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });

  it('dismissed finding → expectation: must_not_flag, zero eval_cases rows', async () => {
    const finding = makeDismissedFinding();
    const container = makeContainer({
      findingContext: async () => ({ finding, review: BASE_REVIEW, pull: BASE_PULL }),
      getPrFiles: async () => [],
      insertCase: insertCaseSpy,
    });

    const draft = await buildCaseDraftFromFinding(container, WS, FINDING_ID);

    expect((draft.expected_output as { expectation: string }).expectation).toBe('must_not_flag');
    // INVARIANT: insertCase must NEVER have been called
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });

  it('file present in prFiles → input_diff is the file patch, not empty', async () => {
    const finding = makeAcceptedFinding();
    const patch = '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42,9 +42,11 @@\n';
    const container = makeContainer({
      findingContext: async () => ({ finding, review: BASE_REVIEW, pull: BASE_PULL }),
      getPrFiles: async () => [{ path: 'src/auth.ts', patch }],
    });

    const draft = await buildCaseDraftFromFinding(container, WS, FINDING_ID);

    expect(draft.input_diff).toBe(patch);
  });

  it('file NOT in prFiles → input_diff is empty string (never fallback to full diff)', async () => {
    const finding = makeAcceptedFinding();
    const container = makeContainer({
      findingContext: async () => ({ finding, review: BASE_REVIEW, pull: BASE_PULL }),
      getPrFiles: async () => [{ path: 'src/other.ts', patch: 'other-patch' }],
    });

    const draft = await buildCaseDraftFromFinding(container, WS, FINDING_ID);

    expect(draft.input_diff).toBe('');
  });

  it('undecided finding → throws ValidationError', async () => {
    const finding = makeUndecidedFinding();
    const container = makeContainer({
      findingContext: async () => ({ finding, review: BASE_REVIEW, pull: BASE_PULL }),
      getPrFiles: async () => [],
    });

    await expect(buildCaseDraftFromFinding(container, WS, FINDING_ID)).rejects.toThrow(
      ValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// (b) createCase: persists and returns the row
// ---------------------------------------------------------------------------

describe('(b) createCase', () => {
  it('valid input → insertCase called once, row returned', async () => {
    const persistedRow = {
      id: 'new-case-1',
      workspaceId: WS,
      ownerKind: 'agent',
      ownerId: AGENT_ID,
      name: 'My case',
      inputDiff: '+foo',
      inputFiles: null,
      inputMeta: null,
      expectedOutput: { expectation: 'must_find', regions: [] },
      notes: null,
    };
    const insertCaseSpy = vi.fn().mockResolvedValue(persistedRow);
    const container = makeContainer({ insertCase: insertCaseSpy });

    const input = {
      owner_kind: 'agent' as const,
      owner_id: AGENT_ID,
      name: 'My case',
      input_diff: '+foo',
      input_files: null,
      input_meta: null,
      expected_output: { expectation: 'must_find', regions: [] },
      notes: null,
    };

    const row = await createCase(container, WS, input);

    expect(insertCaseSpy).toHaveBeenCalledOnce();
    expect(row).toBe(persistedRow);
  });
});

// ---------------------------------------------------------------------------
// (b-2) createCase: owner_id not in caller's workspace → NotFoundError, no row
// ---------------------------------------------------------------------------

describe('(b-2) createCase: owner_id from a different workspace → NotFoundError', () => {
  it('getById returns undefined → NotFoundError, insertCase not called', async () => {
    const insertCaseSpy = vi.fn();
    const container = makeContainer({
      insertCase: insertCaseSpy,
      // getById returns undefined — agent does not exist in this workspace
      getById: async () => undefined,
    });

    const input = {
      owner_kind: 'agent' as const,
      owner_id: 'foreign-agent-id',
      name: 'My case',
      input_diff: '+foo',
      input_files: null,
      input_meta: null,
      expected_output: { expectation: 'must_find', regions: [] },
      notes: null,
    };

    await expect(createCase(container, WS, input)).rejects.toThrow(NotFoundError);
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });

  it('valid agent in workspace → insertCase IS called (control: check the guard passes)', async () => {
    const insertCaseSpy = vi.fn().mockResolvedValue({
      id: 'new-case',
      workspaceId: WS,
      ownerKind: 'agent',
      ownerId: AGENT_ID,
      name: 'Valid',
      inputDiff: '',
      inputFiles: null,
      inputMeta: null,
      expectedOutput: { expectation: 'must_find', regions: [] },
      notes: null,
    });
    const container = makeContainer({
      insertCase: insertCaseSpy,
      getById: async () => BASE_AGENT, // agent exists in this workspace
    });

    const input = {
      owner_kind: 'agent' as const,
      owner_id: AGENT_ID,
      name: 'Valid',
      input_diff: '',
      input_files: null,
      input_meta: null,
      expected_output: { expectation: 'must_find', regions: [] },
      notes: null,
    };

    await createCase(container, WS, input);
    expect(insertCaseSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// (c) cross-workspace findingId → 404 NotFoundError
// ---------------------------------------------------------------------------

describe('(c) cross-workspace findingId → 404', () => {
  it('pull.workspaceId !== workspaceId → NotFoundError', async () => {
    const finding = makeAcceptedFinding();
    // Pull belongs to OTHER_WS, not WS
    const pull = { ...BASE_PULL, workspaceId: OTHER_WS };
    const container = makeContainer({
      findingContext: async () => ({ finding, review: BASE_REVIEW, pull }),
    });

    await expect(buildCaseDraftFromFinding(container, WS, FINDING_ID)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('findingContext returns undefined → NotFoundError', async () => {
    const container = makeContainer({
      findingContext: async () => undefined,
    });

    await expect(buildCaseDraftFromFinding(container, WS, FINDING_ID)).rejects.toThrow(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// (d) runBatch on zero cases → traces_total: 0, zero eval_runs rows
// ---------------------------------------------------------------------------

describe('(d) runBatch: zero cases', () => {
  it('no cases → traces_total: 0 and insertRun never called', async () => {
    const insertRunSpy = vi.fn();
    const container = makeContainer({
      listCases: async () => [],
      insertRun: insertRunSpy,
    });

    const result = await runBatch(container, WS, AGENT_ID);

    expect(result.traces_total).toBe(0);
    expect(insertRunSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e) mid-batch throw on case 2-of-3: rows for 1 & 3 (scored), row for 2 (failed)
// ---------------------------------------------------------------------------

describe('(e) mid-batch error resilience', () => {
  beforeEach(() => {
    vi.mocked(runModule.runCase).mockReset();
  });

  it('case 2 throws → rows for 1 and 3 with scores, failed row for 2, batch completes', async () => {
    const case1 = makeCase('case-1');
    const case2 = makeCase('case-2');
    const case3 = makeCase('case-3');

    vi.mocked(runModule.runCase)
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT)        // case 1: success
      .mockRejectedValueOnce(new Error('LLM error')) // case 2: throw
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT);       // case 3: success

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      listCases: async () => [case1, case2, case3],
      getById: async () => BASE_AGENT,
      linkedSkills: async () => [],
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    const result = await runBatch(container, WS, AGENT_ID);

    // Three rows inserted (one per case)
    expect(insertRunCalls).toHaveLength(3);

    // Case 1 and 3: real pass values (not null)
    expect(insertRunCalls[0]!.caseId).toBe('case-1');
    expect(insertRunCalls[0]!.values.pass).toBe(true);

    expect(insertRunCalls[1]!.caseId).toBe('case-2');
    expect(insertRunCalls[1]!.values.pass).toBeNull();
    expect((insertRunCalls[1]!.values.actualOutput as { error: string }).error).toBe('LLM error');

    expect(insertRunCalls[2]!.caseId).toBe('case-3');
    expect(insertRunCalls[2]!.values.pass).toBe(true);

    // Aggregate covers the 2 successful cases
    expect(result.traces_total).toBe(2);
    expect(result.traces_passed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (f) malformed expected_output → ValidationError, no row persisted
// ---------------------------------------------------------------------------

describe('(f) createCase: malformed expected_output → ValidationError', () => {
  it('missing expectation → throws ValidationError, insertCase not called', async () => {
    const insertCaseSpy = vi.fn();
    const container = makeContainer({ insertCase: insertCaseSpy });

    const input = {
      owner_kind: 'agent' as const,
      owner_id: AGENT_ID,
      name: 'Bad case',
      input_diff: '',
      input_files: null,
      input_meta: null,
      expected_output: { regions: [] }, // missing 'expectation'
      notes: null,
    };

    await expect(createCase(container, WS, input)).rejects.toThrow(ValidationError);
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });

  it('invalid expectation value → throws ValidationError', async () => {
    const insertCaseSpy = vi.fn();
    const container = makeContainer({ insertCase: insertCaseSpy });

    const input = {
      owner_kind: 'agent' as const,
      owner_id: AGENT_ID,
      name: 'Bad case',
      input_diff: '',
      input_files: null,
      input_meta: null,
      expected_output: { expectation: 'wrong_value', regions: [] },
      notes: null,
    };

    await expect(createCase(container, WS, input)).rejects.toThrow(ValidationError);
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (g) runBatch: N cases → N rows sharing one batchId and agentVersion
// ---------------------------------------------------------------------------

describe('(g) runBatch: shared batchId and agentVersion across all rows', () => {
  beforeEach(() => {
    vi.mocked(runModule.runCase).mockReset();
  });

  it('3 cases → 3 rows with identical batchId and agentVersion', async () => {
    const cases = [makeCase('c1'), makeCase('c2'), makeCase('c3')];

    vi.mocked(runModule.runCase).mockResolvedValue(MOCK_RUN_OUTPUT);

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      listCases: async () => cases,
      getById: async () => BASE_AGENT,
      linkedSkills: async () => [],
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    await runBatch(container, WS, AGENT_ID);

    expect(insertRunCalls).toHaveLength(3);

    const batchIds = insertRunCalls.map((c) => c.values.batchId);
    const agentVersions = insertRunCalls.map((c) => c.values.agentVersion);

    // All rows share the same single batchId (generated once)
    expect(new Set(batchIds).size).toBe(1);
    expect(batchIds[0]).toBeTruthy(); // not null/undefined

    // All rows share the same agentVersion
    expect(new Set(agentVersions).size).toBe(1);
    expect(agentVersions[0]).toBe(BASE_AGENT.version);
  });
});

// ---------------------------------------------------------------------------
// listCases — basic behaviour
// ---------------------------------------------------------------------------

describe('listCases', () => {
  it('attaches latestRun: null when no runs exist for a case', async () => {
    const cases = [makeCase(CASE_ID)];
    const container = makeContainer({
      listCases: async () => cases,
      latestRunPerCase: async () => [],
    });

    const result = await listCases(container, WS, AGENT_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.latestRun).toBeNull();
  });

  it('attaches latestRun when a run exists', async () => {
    const cases = [makeCase(CASE_ID)];
    const runRow = {
      caseId: CASE_ID,
      caseName: 'Case c1',
      ranAt: new Date('2026-01-01'),
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      batchId: 'batch-1',
      agentVersion: 2,
    };
    const container = makeContainer({
      listCases: async () => cases,
      latestRunPerCase: async () => [runRow],
    });

    const result = await listCases(container, WS, AGENT_ID);

    expect(result[0]!.latestRun).not.toBeNull();
    expect(result[0]!.latestRun!.pass).toBe(true);
    expect(result[0]!.latestRun!.batchId).toBe('batch-1');
  });
});
