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

// Must appear before the import of service.ts so Vitest hoists them.
vi.mock('./run.js', () => ({
  runCase: vi.fn(),
}));

vi.mock('./harness.js', () => ({
  runSkillCase: vi.fn(),
  runSkillBaselineCase: vi.fn(),
  SKILL_EVAL_HARNESS: {
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    strategy: 'single-pass',
    systemPrompt: '',
  },
}));

// Import after mock registration.
import * as runModule from './run.js';
import * as harnessModule from './harness.js';
import {
  buildCaseDraftFromFinding,
  createCase,
  listCases,
  deleteCase,
  runBatch,
  runCaseOnce,
  runSkillBatch,
  runSkillBenchmark,
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
const SKILL_ID = 'gggggggg-0000-0000-0000-000000000001';

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

const BASE_SKILL = {
  id: SKILL_ID,
  workspaceId: WS,
  name: 'Test Skill',
  description: 'A test skill for eval',
  type: 'rubric' as const,
  source: 'manual' as const,
  body: 'Always check for null pointer dereferences.',
  enabled: true,
  injectionDetected: false,
  version: 2,
  evidenceFiles: null,
  createdAt: new Date('2026-01-01'),
};

function makeSkillCase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: WS,
    ownerKind: 'skill' as const,
    ownerId: SKILL_ID,
    name: `Skill Case ${id}`,
    inputDiff: '',
    inputFiles: null,
    inputMeta: null,
    expectedOutput: { expectation: 'must_find', regions: [] },
    notes: null,
    ...overrides,
  };
}

// Mock finding from runCase (empty → scores as pass with no expected regions)
const MOCK_RUN_OUTPUT = { findings: [], kept: 0, produced: 0, costUsd: 0.001 };

// ---------------------------------------------------------------------------
// Container factory helpers
// ---------------------------------------------------------------------------

type FindingContextResult =
  | { finding: ReturnType<typeof makeAcceptedFinding>; review: typeof BASE_REVIEW; pull: typeof BASE_PULL }
  | undefined;

// Widen ownerKind to 'agent' | 'skill' so the container factory accepts both
// makeCase (agent) and makeSkillCase (skill) fixtures without type errors.
type AnyCase = Omit<ReturnType<typeof makeCase>, 'ownerKind'> & { ownerKind: 'agent' | 'skill' };

function makeContainer(opts: {
  findingContext?: () => Promise<FindingContextResult>;
  getPrFiles?: () => Promise<{ path: string; patch: string | null }[]>;
  insertCase?: (values: unknown) => Promise<Record<string, unknown>>;
  listCases?: () => Promise<AnyCase[]>;
  getCase?: () => Promise<AnyCase | undefined>;
  insertRun?: (caseId: string, values: unknown) => Promise<Record<string, unknown>>;
  latestRunPerCase?: () => Promise<unknown[]>;
  deleteCase?: () => Promise<boolean>;
  getById?: () => Promise<typeof BASE_AGENT | undefined>;
  linkedSkills?: () => Promise<unknown[]>;
  skillsRepoGetById?: () => Promise<typeof BASE_SKILL | undefined>;
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
      deleteCase: opts.deleteCase ?? (async () => true),
    },
    agentsRepo: {
      getById: opts.getById ?? (async () => BASE_AGENT),
      linkedSkills: opts.linkedSkills ?? (async () => []),
    },
    skillsRepo: {
      getById: opts.skillsRepoGetById ?? (async () => undefined),
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

    // AC-6: traces_total = N (all cases attempted), not N-1 (successful only).
    expect(result.traces_total).toBe(3);
    // traces_passed counts only pass === true (both successful cases passed).
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
// (h) AC-6: traces_total = N regardless of per-case LLM errors
// ---------------------------------------------------------------------------

describe('(h) AC-6 traces_total = N: errored cases count toward total, not toward passed', () => {
  beforeEach(() => {
    vi.mocked(runModule.runCase).mockReset();
  });

  it('4 cases, 1 errors, 1 fails scoring, 2 pass → traces_total: 4, traces_passed: 2', async () => {
    // case1, case3: succeed with pass=true (empty expected + empty findings → 0===0 pass)
    // case2: LLM error → persisted with pass: null, NOT counted in traces_passed
    // case4: has expected regions but runCase returns no findings → pass: false
    const case1 = makeCase('case-1');
    const case2 = makeCase('case-2');
    const case3 = makeCase('case-3');
    const case4 = makeCase('case-4', {
      expectedOutput: {
        expectation: 'must_find',
        regions: [
          {
            file: 'src/auth.ts',
            start_line: 10,
            end_line: 20,
            severity: 'WARNING',
            category: 'security',
          },
        ],
      },
    });

    vi.mocked(runModule.runCase)
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT)        // case1: empty findings → pass=true
      .mockRejectedValueOnce(new Error('LLM error')) // case2: throws  → pass=null
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT)        // case3: empty findings → pass=true
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT);       // case4: empty findings → expected not met → pass=false

    const container = makeContainer({
      listCases: async () => [case1, case2, case3, case4],
      getById: async () => BASE_AGENT,
      linkedSkills: async () => [],
    });

    const result = await runBatch(container, WS, AGENT_ID);

    // AC-6: traces_total must equal ALL N cases attempted (successful + errored).
    expect(result.traces_total).toBe(4);
    // traces_passed: only cases 1 and 3 actually passed; case2 (error) and case4 (fail) do not.
    expect(result.traces_passed).toBe(2);
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

    const result = await listCases(container, WS, 'agent', AGENT_ID);

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

    const result = await listCases(container, WS, 'agent', AGENT_ID);

    expect(result[0]!.latestRun).not.toBeNull();
    expect(result[0]!.latestRun!.pass).toBe(true);
    expect(result[0]!.latestRun!.batchId).toBe('batch-1');
  });
});

// ---------------------------------------------------------------------------
// deleteCase: repository delete called once; NotFoundError when no row deleted
// ---------------------------------------------------------------------------

describe('deleteCase', () => {
  it('deletes the case and returns void when the repository reports a row deleted', async () => {
    const deleteCaseSpy = vi.fn(async () => true);
    const container = makeContainer({ deleteCase: deleteCaseSpy });

    await expect(deleteCase(container, WS, CASE_ID)).resolves.toBeUndefined();
    expect(deleteCaseSpy).toHaveBeenCalledOnce();
    expect(deleteCaseSpy).toHaveBeenCalledWith(WS, CASE_ID);
  });

  it('throws NotFoundError when the repository deletes nothing (missing or cross-workspace)', async () => {
    const container = makeContainer({ deleteCase: async () => false });

    await expect(deleteCase(container, WS, CASE_ID)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// (i) runCaseOnce: persists non-null durationMs and costUsd
// ---------------------------------------------------------------------------

describe('(i) runCaseOnce: persists real durationMs and costUsd', () => {
  beforeEach(() => {
    vi.mocked(runModule.runCase).mockReset();
  });

  it('persists non-null durationMs and the case costUsd on the eval_runs row', async () => {
    const evalCase = makeCase(CASE_ID);

    // runCase returns a cost value so service.ts can thread it through.
    vi.mocked(runModule.runCase).mockResolvedValue({
      findings: [],
      kept: 0,
      produced: 0,
      costUsd: 0.005,
    });

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      getCase: async () => evalCase,
      getById: async () => BASE_AGENT,
      linkedSkills: async () => [],
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    const { result } = await runCaseOnce(container, WS, CASE_ID);

    expect(insertRunCalls).toHaveLength(1);
    const persisted = insertRunCalls[0]!.values;

    // durationMs should be a non-null number (wall-clock time ≥ 0).
    expect(persisted.durationMs).not.toBeNull();
    expect(typeof persisted.durationMs).toBe('number');
    expect(persisted.durationMs as number).toBeGreaterThanOrEqual(0);

    // costUsd should be the value returned by runCase, not null.
    expect(persisted.costUsd).toBe(0.005);

    // The returned EvalRun must also carry the cost.
    expect(result.cost_usd).toBe(0.005);
  });
});

// ---------------------------------------------------------------------------
// (j) runBatch: cost_usd = sum of per-case costs; null-cost case contributes 0
// ---------------------------------------------------------------------------

describe('(j) runBatch: cost_usd is sum of per-case costs with null-safe accumulation', () => {
  beforeEach(() => {
    vi.mocked(runModule.runCase).mockReset();
  });

  it('sums per-case costUsd; a null-cost case contributes 0, not NaN', async () => {
    const case1 = makeCase('cost-case-1');
    const case2 = makeCase('cost-case-2'); // will error → null cost
    const case3 = makeCase('cost-case-3');

    vi.mocked(runModule.runCase)
      .mockResolvedValueOnce({ findings: [], kept: 0, produced: 0, costUsd: 0.010 })
      .mockRejectedValueOnce(new Error('LLM timeout'))   // case2 errors → costUsd: null
      .mockResolvedValueOnce({ findings: [], kept: 0, produced: 0, costUsd: 0.020 });

    const container = makeContainer({
      listCases: async () => [case1, case2, case3],
      getById: async () => BASE_AGENT,
      linkedSkills: async () => [],
    });

    const result = await runBatch(container, WS, AGENT_ID);

    // case1 (0.010) + case2 (error → 0) + case3 (0.020) = 0.030
    expect(result.cost_usd).toBeCloseTo(0.030, 10);
    // Sanity: total cases = 3, passed = 2 (case2 errored, not passed).
    expect(result.traces_total).toBe(3);
    expect(result.traces_passed).toBe(2);
  });

  it('returns cost_usd = 0 when all cases error (no successful cost accumulation)', async () => {
    const case1 = makeCase('err-case-1');
    const case2 = makeCase('err-case-2');

    vi.mocked(runModule.runCase)
      .mockRejectedValueOnce(new Error('error A'))
      .mockRejectedValueOnce(new Error('error B'));

    const container = makeContainer({
      listCases: async () => [case1, case2],
      getById: async () => BASE_AGENT,
      linkedSkills: async () => [],
    });

    const result = await runBatch(container, WS, AGENT_ID);

    expect(result.cost_usd).toBe(0);
    expect(result.traces_total).toBe(2);
    expect(result.traces_passed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (T2-a) createCase — skill owner_kind branches
// ---------------------------------------------------------------------------

describe('(T2-a) createCase: skill owner_kind', () => {
  it('valid skill id → insertCase called once, row returned', async () => {
    const persistedRow = {
      id: 'new-skill-case-1',
      workspaceId: WS,
      ownerKind: 'skill',
      ownerId: SKILL_ID,
      name: 'Skill case',
      inputDiff: '+foo',
      inputFiles: null,
      inputMeta: null,
      expectedOutput: { expectation: 'must_find', regions: [] },
      notes: null,
    };
    const insertCaseSpy = vi.fn().mockResolvedValue(persistedRow);
    const container = makeContainer({
      insertCase: insertCaseSpy,
      skillsRepoGetById: async () => BASE_SKILL,
    });

    const input = {
      owner_kind: 'skill' as const,
      owner_id: SKILL_ID,
      name: 'Skill case',
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

  it('missing/cross-workspace skill id → NotFoundError, insertCase not called', async () => {
    const insertCaseSpy = vi.fn();
    const container = makeContainer({
      insertCase: insertCaseSpy,
      // skillsRepoGetById returns undefined — skill not found in workspace
      skillsRepoGetById: async () => undefined,
    });

    const input = {
      owner_kind: 'skill' as const,
      owner_id: 'foreign-skill-id',
      name: 'Bad skill case',
      input_diff: '+foo',
      input_files: null,
      input_meta: null,
      expected_output: { expectation: 'must_find', regions: [] },
      notes: null,
    };

    await expect(createCase(container, WS, input)).rejects.toThrow(NotFoundError);
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (T2-b) runCaseOnce: skill-owned case uses harness.runSkillCase, not run.runCase
// ---------------------------------------------------------------------------

describe('(T2-b) runCaseOnce: skill-owned case', () => {
  beforeEach(() => {
    vi.mocked(runModule.runCase).mockReset();
    vi.mocked(harnessModule.runSkillCase).mockReset();
  });

  it('skill case drives harness.runSkillCase (not runCase), stamps agentVersion = skill.version', async () => {
    const evalCase = makeSkillCase(CASE_ID);

    vi.mocked(harnessModule.runSkillCase).mockResolvedValue({
      findings: [],
      kept: 0,
      produced: 0,
      costUsd: 0.007,
    });

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      getCase: async () => evalCase,
      skillsRepoGetById: async () => BASE_SKILL,
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    await runCaseOnce(container, WS, CASE_ID);

    // harness.runSkillCase must have been called, not runCase
    expect(harnessModule.runSkillCase).toHaveBeenCalledOnce();
    expect(runModule.runCase).not.toHaveBeenCalled();

    // agentVersion on the row must equal the skill's version
    expect(insertRunCalls).toHaveLength(1);
    expect(insertRunCalls[0]!.values.agentVersion).toBe(BASE_SKILL.version);
    expect(insertRunCalls[0]!.values.costUsd).toBe(0.007);
  });
});

// ---------------------------------------------------------------------------
// (T2-c) runSkillBatch: zero cases → traces_total: 0, zero insertRun calls
// ---------------------------------------------------------------------------

describe('(T2-c) runSkillBatch: zero cases', () => {
  it('no cases → traces_total: 0, insertRun never called', async () => {
    const insertRunSpy = vi.fn();
    const container = makeContainer({
      listCases: async () => [],
      insertRun: insertRunSpy,
    });

    const result = await runSkillBatch(container, WS, SKILL_ID);

    expect(result.traces_total).toBe(0);
    expect(insertRunSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (T2-d) runSkillBatch: case 2 of 3 throws mid-batch
// ---------------------------------------------------------------------------

describe('(T2-d) runSkillBatch: mid-batch error resilience', () => {
  beforeEach(() => {
    vi.mocked(harnessModule.runSkillCase).mockReset();
  });

  it('case 2 throws → rows for 1 and 3 (scored), failed row for 2, all share batchId, traces_total: 3', async () => {
    const case1 = makeSkillCase('sk-case-1');
    const case2 = makeSkillCase('sk-case-2');
    const case3 = makeSkillCase('sk-case-3');

    vi.mocked(harnessModule.runSkillCase)
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT)        // case 1: success
      .mockRejectedValueOnce(new Error('LLM error')) // case 2: throw
      .mockResolvedValueOnce(MOCK_RUN_OUTPUT);       // case 3: success

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      listCases: async () => [case1, case2, case3],
      skillsRepoGetById: async () => BASE_SKILL,
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    const result = await runSkillBatch(container, WS, SKILL_ID);

    // Three rows: one per case
    expect(insertRunCalls).toHaveLength(3);

    // Case 1: success
    expect(insertRunCalls[0]!.caseId).toBe('sk-case-1');
    expect(insertRunCalls[0]!.values.pass).toBe(true);

    // Case 2: failed row
    expect(insertRunCalls[1]!.caseId).toBe('sk-case-2');
    expect(insertRunCalls[1]!.values.pass).toBeNull();
    expect((insertRunCalls[1]!.values.actualOutput as { error: string }).error).toBe('LLM error');

    // Case 3: success
    expect(insertRunCalls[2]!.caseId).toBe('sk-case-3');
    expect(insertRunCalls[2]!.values.pass).toBe(true);

    // All rows share the same batchId
    const batchIds = insertRunCalls.map((c) => c.values.batchId);
    expect(new Set(batchIds).size).toBe(1);
    expect(batchIds[0]).toBeTruthy();

    // All rows share skill.version in the agentVersion column
    const agentVersions = insertRunCalls.map((c) => c.values.agentVersion);
    expect(new Set(agentVersions).size).toBe(1);
    expect(agentVersions[0]).toBe(BASE_SKILL.version);

    // traces_total = all cases attempted
    expect(result.traces_total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (T2-e) injectionDetected: true → single-run AND batch both refuse, zero insertRun
// ---------------------------------------------------------------------------

describe('(T2-e) injectionDetected skill → eval refused, zero insertRun calls', () => {
  beforeEach(() => {
    vi.mocked(harnessModule.runSkillCase).mockReset();
  });

  it('runCaseOnce with injectionDetected skill → throws ValidationError, zero insertRun', async () => {
    const evalCase = makeSkillCase(CASE_ID);
    const injectedSkill = { ...BASE_SKILL, injectionDetected: true };

    const insertRunSpy = vi.fn();
    const container = makeContainer({
      getCase: async () => evalCase,
      skillsRepoGetById: async () => injectedSkill,
      insertRun: insertRunSpy,
    });

    await expect(runCaseOnce(container, WS, CASE_ID)).rejects.toThrow(ValidationError);
    expect(insertRunSpy).not.toHaveBeenCalled();
    expect(harnessModule.runSkillCase).not.toHaveBeenCalled();
  });

  it('runSkillBatch with injectionDetected skill → throws ValidationError, zero insertRun', async () => {
    const case1 = makeSkillCase('inj-case-1');
    const injectedSkill = { ...BASE_SKILL, injectionDetected: true };

    const insertRunSpy = vi.fn();
    const container = makeContainer({
      listCases: async () => [case1],
      skillsRepoGetById: async () => injectedSkill,
      insertRun: insertRunSpy,
    });

    await expect(runSkillBatch(container, WS, SKILL_ID)).rejects.toThrow(ValidationError);
    expect(insertRunSpy).not.toHaveBeenCalled();
    expect(harnessModule.runSkillCase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (T2-f) cross-workspace skill id → 404 on create and run
// ---------------------------------------------------------------------------

describe('(T2-f) cross-workspace skill id → 404, zero persistence', () => {
  it('createCase: skill not in workspace → NotFoundError, insertCase not called', async () => {
    const insertCaseSpy = vi.fn();
    const container = makeContainer({
      insertCase: insertCaseSpy,
      // skillsRepoGetById returns undefined — cross-workspace or missing
      skillsRepoGetById: async () => undefined,
    });

    const input = {
      owner_kind: 'skill' as const,
      owner_id: 'other-ws-skill-id',
      name: 'Cross workspace case',
      input_diff: '',
      input_files: null,
      input_meta: null,
      expected_output: { expectation: 'must_find', regions: [] },
      notes: null,
    };

    await expect(createCase(container, WS, input)).rejects.toThrow(NotFoundError);
    expect(insertCaseSpy).not.toHaveBeenCalled();
  });

  it('runCaseOnce: skill not in workspace → NotFoundError, insertRun not called', async () => {
    const evalCase = makeSkillCase(CASE_ID);
    const insertRunSpy = vi.fn();
    const container = makeContainer({
      getCase: async () => evalCase,
      skillsRepoGetById: async () => undefined, // cross-workspace
      insertRun: insertRunSpy,
    });

    await expect(runCaseOnce(container, WS, CASE_ID)).rejects.toThrow(NotFoundError);
    expect(insertRunSpy).not.toHaveBeenCalled();
  });

  it('runSkillBatch: skill not in workspace → NotFoundError, insertRun not called', async () => {
    const case1 = makeSkillCase('xws-case-1');
    const insertRunSpy = vi.fn();
    const container = makeContainer({
      listCases: async () => [case1],
      skillsRepoGetById: async () => undefined, // cross-workspace
      insertRun: insertRunSpy,
    });

    await expect(runSkillBatch(container, WS, SKILL_ID)).rejects.toThrow(NotFoundError);
    expect(insertRunSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (T6-a) runSkillBenchmark: drives BOTH arms per case, returns correct shape
// ---------------------------------------------------------------------------

describe('(T6-a) runSkillBenchmark: drives both arms per case, correct shape (AC-20, AC-22)', () => {
  beforeEach(() => {
    vi.mocked(harnessModule.runSkillCase).mockReset();
    vi.mocked(harnessModule.runSkillBaselineCase).mockReset();
  });

  it('2 cases → runSkillCase and runSkillBaselineCase each called twice, correct {candidate, baseline, delta, per_case}', async () => {
    const case1 = makeSkillCase('bm-case-1');
    const case2 = makeSkillCase('bm-case-2');

    vi.mocked(harnessModule.runSkillCase).mockResolvedValue({
      findings: [], kept: 0, produced: 0, costUsd: 0.005,
    });
    vi.mocked(harnessModule.runSkillBaselineCase).mockResolvedValue({
      findings: [], kept: 0, produced: 0, costUsd: 0.003,
    });

    const container = makeContainer({
      listCases: async () => [case1, case2],
      skillsRepoGetById: async () => BASE_SKILL,
    });

    const result = await runSkillBenchmark(container, WS, SKILL_ID);

    // Both arms called once per case (2 cases = 2 calls each)
    expect(harnessModule.runSkillCase).toHaveBeenCalledTimes(2);
    expect(harnessModule.runSkillBaselineCase).toHaveBeenCalledTimes(2);

    // Shape: candidate, baseline, delta, per_case
    expect(result).toHaveProperty('candidate');
    expect(result).toHaveProperty('baseline');
    expect(result).toHaveProperty('delta');
    expect(result).toHaveProperty('per_case');

    // per_case has one entry per case
    expect(result.per_case).toHaveLength(2);
    expect(result.per_case[0]).toMatchObject({
      case_id: 'bm-case-1',
      case_name: 'Skill Case bm-case-1',
      candidate_pass: true,  // must_find + empty expected + empty findings = pass
      baseline_pass: true,
    });
    expect(result.per_case[1]).toMatchObject({
      case_id: 'bm-case-2',
      case_name: 'Skill Case bm-case-2',
      candidate_pass: true,
      baseline_pass: true,
    });

    // delta fields are numbers (recall - recall, precision - precision, etc.)
    expect(typeof result.delta.recall).toBe('number');
    expect(typeof result.delta.precision).toBe('number');
    expect(typeof result.delta.citation_accuracy).toBe('number');

    // traces_total overridden to cases.length
    expect(result.candidate.traces_total).toBe(2);
    expect(result.baseline.traces_total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (T6-b) runSkillBenchmark: persists ONLY candidate rows (AC-23)
// THE SINGLE MOST IMPORTANT TEST — zero baseline insertRun calls
// ---------------------------------------------------------------------------

describe('(T6-b) runSkillBenchmark: persists ONLY candidate rows, never baseline (AC-23)', () => {
  beforeEach(() => {
    vi.mocked(harnessModule.runSkillCase).mockReset();
    vi.mocked(harnessModule.runSkillBaselineCase).mockReset();
  });

  it('3 cases → insertRun called exactly 3 times (candidate only), all share one batchId and skill.version', async () => {
    const case1 = makeSkillCase('only-c1');
    const case2 = makeSkillCase('only-c2');
    const case3 = makeSkillCase('only-c3');

    vi.mocked(harnessModule.runSkillCase).mockResolvedValue({
      findings: [], kept: 0, produced: 0, costUsd: 0.002,
    });
    vi.mocked(harnessModule.runSkillBaselineCase).mockResolvedValue({
      findings: [], kept: 0, produced: 0, costUsd: 0.001,
    });

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      listCases: async () => [case1, case2, case3],
      skillsRepoGetById: async () => BASE_SKILL,
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    await runSkillBenchmark(container, WS, SKILL_ID);

    // CRITICAL: exactly 3 insertRun calls — one candidate per case, ZERO baseline rows.
    expect(insertRunCalls).toHaveLength(3);

    // All share ONE batchId (generated once for the benchmark).
    const batchIds = insertRunCalls.map((c) => c.values.batchId);
    expect(new Set(batchIds).size).toBe(1);
    expect(batchIds[0]).toBeTruthy();

    // All agentVersion fields match the skill's version (candidate metadata only).
    const agentVersions = insertRunCalls.map((c) => c.values.agentVersion);
    expect(new Set(agentVersions).size).toBe(1);
    expect(agentVersions[0]).toBe(BASE_SKILL.version);

    // Confirm case IDs correspond to all 3 candidate cases (not baseline ghosts).
    const caseIds = insertRunCalls.map((c) => c.caseId);
    expect(caseIds).toContain('only-c1');
    expect(caseIds).toContain('only-c2');
    expect(caseIds).toContain('only-c3');
  });
});

// ---------------------------------------------------------------------------
// (T6-c) runSkillBenchmark: empty case set (AC-25)
// ---------------------------------------------------------------------------

describe('(T6-c) runSkillBenchmark: empty case set → zero aggregates, zero insertRun calls (AC-25)', () => {
  it('no cases → traces_total: 0 for both arms, zero-valued delta, empty per_case, zero insertRun', async () => {
    const insertRunSpy = vi.fn();
    const container = makeContainer({
      listCases: async () => [],
      insertRun: insertRunSpy,
    });

    const result = await runSkillBenchmark(container, WS, SKILL_ID);

    expect(result.candidate.traces_total).toBe(0);
    expect(result.baseline.traces_total).toBe(0);
    expect(result.delta).toEqual({ recall: 0, precision: 0, citation_accuracy: 0 });
    expect(result.per_case).toHaveLength(0);
    expect(insertRunSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (T6-d) runSkillBenchmark: injectionDetected skill → throws, zero insertRun (AC-24)
// ---------------------------------------------------------------------------

describe('(T6-d) runSkillBenchmark: injectionDetected skill → ValidationError, zero insertRun (AC-24)', () => {
  it('injection-flagged skill → throws ValidationError, insertRun never called', async () => {
    const case1 = makeSkillCase('inj-bm-1');
    const injectedSkill = { ...BASE_SKILL, injectionDetected: true };
    const insertRunSpy = vi.fn();
    const container = makeContainer({
      listCases: async () => [case1],
      skillsRepoGetById: async () => injectedSkill,
      insertRun: insertRunSpy,
    });

    await expect(runSkillBenchmark(container, WS, SKILL_ID)).rejects.toThrow(ValidationError);
    expect(insertRunSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (T6-e) runSkillBenchmark: baseline-arm throw on case 2 of 3 (AC-26)
// ---------------------------------------------------------------------------

describe('(T6-e) runSkillBenchmark: baseline-arm throw on case 2 → baseline_pass: null, all 3 candidate rows persisted (AC-26)', () => {
  beforeEach(() => {
    vi.mocked(harnessModule.runSkillCase).mockReset();
    vi.mocked(harnessModule.runSkillBaselineCase).mockReset();
  });

  it('case 2 baseline throws → per_case[1].baseline_pass: null, 3 candidate insertRun calls, cases 1 and 3 fully intact', async () => {
    const case1 = makeSkillCase('bl-fail-c1');
    const case2 = makeSkillCase('bl-fail-c2');
    const case3 = makeSkillCase('bl-fail-c3');

    // Candidate arm succeeds for all 3
    vi.mocked(harnessModule.runSkillCase).mockResolvedValue({
      findings: [], kept: 0, produced: 0, costUsd: 0.004,
    });

    // Baseline arm: succeeds for case1, throws for case2, succeeds for case3
    vi.mocked(harnessModule.runSkillBaselineCase)
      .mockResolvedValueOnce({ findings: [], kept: 0, produced: 0, costUsd: 0.002 })
      .mockRejectedValueOnce(new Error('Baseline LLM timeout'))
      .mockResolvedValueOnce({ findings: [], kept: 0, produced: 0, costUsd: 0.002 });

    const insertRunCalls: Array<{ caseId: string; values: Record<string, unknown> }> = [];
    const container = makeContainer({
      listCases: async () => [case1, case2, case3],
      skillsRepoGetById: async () => BASE_SKILL,
      insertRun: async (caseId, values) => {
        insertRunCalls.push({ caseId, values: values as Record<string, unknown> });
        return { id: `run-${caseId}`, caseId, ...values as object };
      },
    });

    const result = await runSkillBenchmark(container, WS, SKILL_ID);

    // Exactly 3 candidate insertRun calls — NOT 6 (no baseline rows persisted).
    expect(insertRunCalls).toHaveLength(3);
    expect(insertRunCalls[0]!.caseId).toBe('bl-fail-c1');
    expect(insertRunCalls[1]!.caseId).toBe('bl-fail-c2');
    expect(insertRunCalls[2]!.caseId).toBe('bl-fail-c3');

    // All candidate rows have non-null pass (candidate arm succeeded for all 3)
    expect(insertRunCalls[0]!.values.pass).toBe(true);
    expect(insertRunCalls[1]!.values.pass).toBe(true);
    expect(insertRunCalls[2]!.values.pass).toBe(true);

    // per_case has 3 entries
    expect(result.per_case).toHaveLength(3);

    // Case 1: both arms succeeded
    expect(result.per_case[0]).toMatchObject({
      case_id: 'bl-fail-c1',
      candidate_pass: true,
      baseline_pass: true,
    });

    // Case 2: candidate succeeded, baseline failed → baseline_pass: null
    expect(result.per_case[1]).toMatchObject({
      case_id: 'bl-fail-c2',
      candidate_pass: true,
      baseline_pass: null,
    });

    // Case 3: both arms succeeded (execution continued after case 2 failure)
    expect(result.per_case[2]).toMatchObject({
      case_id: 'bl-fail-c3',
      candidate_pass: true,
      baseline_pass: true,
    });

    // traces_total = all cases attempted (including case 2 which had a baseline error)
    expect(result.candidate.traces_total).toBe(3);
    expect(result.baseline.traces_total).toBe(3);
  });
});
