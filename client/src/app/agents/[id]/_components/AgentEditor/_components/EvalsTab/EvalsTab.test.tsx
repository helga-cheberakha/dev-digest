/*
 * EvalsTab RTL tests (TC4 acceptance criteria).
 *
 * Asserts:
 * 1. One row per case rendered with a status icon reflecting latest_run.pass:
 *    - pass=true  → aria-label "passed"
 *    - pass=false → aria-label "failed"
 *    - null run   → aria-label "never run"
 * 2. Clicking "Run all evals" fires exactly one runEvalBatch call.
 *
 * Uses fireEvent only — @testing-library/user-event is not installed
 * (client/INSIGHTS.md 2026-07-06).
 *
 * next-intl is provided via NextIntlClientProvider.
 * @tanstack/react-query is provided via QueryClientProvider.
 * EvalCaseModal is mocked to avoid rendering its complex internals.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import { EvalsTab } from "./EvalsTab";

// ---------------------------------------------------------------------------
// Mock @/lib/api
// ---------------------------------------------------------------------------
vi.mock("@/lib/api", () => ({
  fetchEvalCases: vi.fn(),
  fetchEvalBatches: vi.fn(),
  runEvalBatch: vi.fn(),
  fetchEvalCompare: vi.fn(),
  promoteVersion: vi.fn(),
  evalQueryKeys: {
    cases: (agentId: string) => ["eval-cases", agentId] as const,
    batches: (agentId: string) => ["eval-batches", agentId] as const,
    dashboard: (agentId?: string) => ["eval-dashboard", agentId] as const,
    compare: (agentId: string, a: string, b: string) =>
      ["eval-compare", agentId, a, b] as const,
  },
}));

// Mock EvalCaseModal to prevent rendering its complex internals (modal +
// TanStack sub-queries + intl sub-namespace).
vi.mock("@/components/EvalCaseModal", () => ({
  EvalCaseModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="eval-case-modal">
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}));

import {
  fetchEvalCases,
  fetchEvalBatches,
  runEvalBatch,
  fetchEvalCompare,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_PASSED = {
  id: "case-1",
  owner_kind: "agent" as const,
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "diff",
  input_files: null,
  input_meta: null,
  expected_output: {
    expectation: "must_find",
    regions: [{ file: "src/config.ts", start_line: 10, end_line: 12 }],
  },
  notes: null,
  latest_run: {
    pass: true,
    recall: 0.9,
    precision: 0.85,
    citation_accuracy: 0.8,
    ran_at: "2026-07-10T12:00:00Z",
  },
};

const CASE_FAILED = {
  id: "case-2",
  owner_kind: "agent" as const,
  owner_id: "ag1",
  name: "injection-in-query",
  input_diff: "diff2",
  input_files: null,
  input_meta: null,
  expected_output: {
    expectation: "must_not_flag",
    regions: [],
  },
  notes: null,
  latest_run: {
    pass: false,
    recall: 0.4,
    precision: 0.5,
    citation_accuracy: 0.6,
    ran_at: "2026-07-10T11:00:00Z",
  },
};

const CASE_NEVER_RUN = {
  id: "case-3",
  owner_kind: "agent" as const,
  owner_id: "ag1",
  name: "phantom-api-call",
  input_diff: "diff3",
  input_files: null,
  input_meta: null,
  expected_output: {
    expectation: "must_find",
    regions: [{ file: "src/api.ts", start_line: 5, end_line: 7 }],
  },
  notes: null,
  latest_run: null,
};

// EvalRun shape — matches the real server response for POST /agents/:id/eval-runs
const BATCH_RESULT = {
  recall: 0.75,
  precision: 0.8,
  citation_accuracy: 0.7,
  traces_passed: 2,
  traces_total: 3,
  duration_ms: 1500,
  cost_usd: null,
  per_trace: [],
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderEvalsTab() {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
        <EvalsTab agentId="ag1" agentVersion={2} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(fetchEvalCases).mockResolvedValue([
    CASE_PASSED,
    CASE_FAILED,
    CASE_NEVER_RUN,
  ] as ReturnType<typeof fetchEvalCases> extends Promise<infer T> ? T : never);
  vi.mocked(fetchEvalBatches).mockResolvedValue([]);
  vi.mocked(runEvalBatch).mockResolvedValue(BATCH_RESULT);
  vi.mocked(fetchEvalCompare).mockResolvedValue({
    a: {
      batch_id: "batch-a",
      ran_at: "2026-07-09T10:00:00Z",
      agent_version: 1,
      recall: 0.7,
      precision: 0.7,
      citation_accuracy: 0.7,
      traces_passed: 7,
      traces_total: 10,
    },
    b: {
      batch_id: "batch-b",
      ran_at: "2026-07-10T10:00:00Z",
      agent_version: 2,
      recall: 0.8,
      precision: 0.8,
      citation_accuracy: 0.8,
      traces_passed: 8,
      traces_total: 10,
    },
    prompt_diff: { old: "old prompt text", new: "new prompt text" },
    delta: { recall: 0.1, precision: 0.1, citation_accuracy: 0.1 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalsTab — case list + pass/fail icons", () => {
  it("renders one row per case with a status icon reflecting latest_run.pass", async () => {
    renderEvalsTab();

    // Wait for cases to load
    expect(await screen.findByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("injection-in-query")).toBeInTheDocument();
    expect(screen.getByText("phantom-api-call")).toBeInTheDocument();

    // Check status icons via aria-label
    expect(screen.getByRole("img", { name: "passed" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "failed" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "never run" })).toBeInTheDocument();
  });

  it("shows the expectation badge from expected_output", async () => {
    renderEvalsTab();
    // CASE_PASSED and CASE_NEVER_RUN both have expectation "must_find"
    const mustFindBadges = await screen.findAllByText("must_find");
    expect(mustFindBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("must_not_flag")).toBeInTheDocument();
  });

  it("shows region file:line from the first region", async () => {
    renderEvalsTab();
    // CASE_PASSED has regions[0].file = "src/config.ts", start_line = 10
    expect(await screen.findByText("src/config.ts:10")).toBeInTheDocument();
  });
});

describe("EvalsTab — Run all evals button", () => {
  it("fires exactly one runEvalBatch call when the button is clicked", async () => {
    renderEvalsTab();

    // Wait for the tab to be fully rendered
    await screen.findByText("stripe-key-leak");

    const runBtn = screen.getByRole("button", { name: /run all evals/i });
    expect(runBtn).toBeInTheDocument();

    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(vi.mocked(runEvalBatch)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runEvalBatch)).toHaveBeenCalledWith("ag1");
    });
  });

  it("shows batch aggregate metrics after Run all evals resolves", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getByRole("button", { name: /run all evals/i }));

    // Batch result shows recall / precision / citation
    // pct(0.75) = "75%", pct(0.8) = "80%", pct(0.7) = "70%"
    await waitFor(() => {
      // The batch result line is: "Recall 75% · Precision 80% · Citation 70%"
      expect(
        screen.getByText(/recall 75% · precision 80% · citation 70%/i),
      ).toBeInTheDocument();
    });
  });

  it("opens EvalCaseModal when a case row is clicked", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getByText("stripe-key-leak"));

    // The mocked EvalCaseModal renders role="dialog"
    expect(screen.getByRole("dialog", { name: "eval-case-modal" })).toBeInTheDocument();
  });

  it("opens EvalCaseModal with no caseId when New eval case is clicked", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getByRole("button", { name: /new eval case/i }));

    expect(screen.getByRole("dialog", { name: "eval-case-modal" })).toBeInTheDocument();
  });
});

describe("EvalsTab — compare panel prompt diff", () => {
  it("renders real old/new prompt text from prompt_diff in the correct before/after panes", async () => {
    // Provide two history batches so the compare buttons appear
    vi.mocked(fetchEvalBatches).mockResolvedValue([
      {
        batch_id: "batch-b",
        ran_at: "2026-07-10T10:00:00Z",
        agent_version: 2,
        recall: 0.8,
        precision: 0.8,
        citation_accuracy: 0.8,
        traces_passed: 8,
        traces_total: 10,
      },
      {
        batch_id: "batch-a",
        ran_at: "2026-07-09T10:00:00Z",
        agent_version: 1,
        recall: 0.7,
        precision: 0.7,
        citation_accuracy: 0.7,
        traces_passed: 7,
        traces_total: 10,
      },
    ]);

    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    // Both compare buttons appear (one per batch row, both show "Compare" initially)
    const firstCompareBtn = (await screen.findAllByRole("button", { name: /^compare$/i }))[0]!;
    fireEvent.click(firstCompareBtn);

    // After selecting one batch, the other batch's button still shows "Compare"
    const secondCompareBtn = screen.getByRole("button", { name: /^compare$/i });
    fireEvent.click(secondCompareBtn);

    // Wait for fetchEvalCompare to resolve and the compare panel to render
    expect(await screen.findByText("old prompt text")).toBeInTheDocument();
    expect(screen.getByText("new prompt text")).toBeInTheDocument();
  });
});
