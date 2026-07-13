/*
 * EvalsTab RTL tests (TC4 acceptance criteria).
 *
 * Asserts:
 * 1. One row per case rendered with a status icon reflecting latest_run.pass:
 *    - pass=true  → aria-label "passed"
 *    - pass=false → aria-label "failed"
 *    - null run   → aria-label "never run"
 * 2. The metrics strip renders recall/precision/citation/traces-passed tiles
 *    from fetchEvalDashboard.
 * 3. Clicking "Run all evals" fires exactly one runEvalBatch call.
 * 4. Row action icons fire runEvalCase / open the edit modal / deleteEvalCase
 *    (delete gated behind window.confirm).
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
  fetchEvalDashboard: vi.fn(),
  runEvalBatch: vi.fn(),
  runEvalCase: vi.fn(),
  deleteEvalCase: vi.fn(),
  evalQueryKeys: {
    cases: (agentId: string) => ["eval-cases", agentId] as const,
    dashboard: (agentId?: string) => ["eval-dashboard", agentId] as const,
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
  fetchEvalDashboard,
  runEvalBatch,
  runEvalCase,
  deleteEvalCase,
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
    regions: [{ file: "src/config.ts", start_line: 10, end_line: 12, severity: "CRITICAL", category: "security" }],
  },
  notes: null,
  latest_run: {
    pass: true,
    recall: 1,
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

const DASHBOARD = {
  owner_kind: "agent" as const,
  owner_id: "ag1",
  cases_total: 3,
  current: {
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    cost_usd: 0.1,
  },
  delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
  trend: [],
  recent_runs: [],
  alert: null,
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
        <EvalsTab agentId="ag1" agentName="Security Reviewer" />
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
  vi.mocked(fetchEvalDashboard).mockResolvedValue(DASHBOARD);
  vi.mocked(runEvalBatch).mockResolvedValue(BATCH_RESULT);
  vi.mocked(runEvalCase).mockResolvedValue({
    run_id: "run-1",
    case_id: "case-1",
    result: BATCH_RESULT,
  });
  vi.mocked(deleteEvalCase).mockResolvedValue(undefined);
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

  it("shows the severity · category badge from the first expected region", async () => {
    renderEvalsTab();
    expect(await screen.findByText("CRITICAL · security")).toBeInTheDocument();
  });

  it("shows the empty [] badge for a must_not_flag case with no regions", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");
    expect(screen.getByText("empty []")).toBeInTheDocument();
  });

  it("derives 'expected N finding(s), got M' from recall for a passed case", async () => {
    renderEvalsTab();
    // CASE_PASSED: 1 region, recall 1 → got 1
    expect(await screen.findByText("expected 1 finding, got 1")).toBeInTheDocument();
  });

  it("shows 'never run' subtitle for a case with no latest_run", async () => {
    renderEvalsTab();
    // "never run" appears both as the status icon aria-label and the subtitle text
    const neverRunTexts = await screen.findAllByText("never run");
    expect(neverRunTexts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("EvalsTab — metrics strip", () => {
  it("renders recall/precision/citation/traces-passed tiles from the dashboard", async () => {
    renderEvalsTab();
    expect(await screen.findByText("82%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
  });

  it("renders a link to the full dashboard", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");
    const link = screen.getByRole("link", { name: /view full dashboard/i });
    expect(link).toHaveAttribute("href", "/eval/ag1");
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

describe("EvalsTab — per-row run/edit/delete actions", () => {
  it("clicking the row's run icon calls runEvalCase and does not open the modal", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getAllByLabelText("Run case")[0]!);

    await waitFor(() => {
      expect(vi.mocked(runEvalCase)).toHaveBeenCalledWith("case-1");
    });
    expect(screen.queryByRole("dialog", { name: "eval-case-modal" })).not.toBeInTheDocument();
  });

  it("clicking the row's edit icon opens the modal without triggering a run", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getAllByLabelText("Edit case")[0]!);

    expect(screen.getByRole("dialog", { name: "eval-case-modal" })).toBeInTheDocument();
    expect(vi.mocked(runEvalCase)).not.toHaveBeenCalled();
  });

  it("clicking the row's delete icon calls deleteEvalCase after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getAllByLabelText("Delete case")[0]!);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(vi.mocked(deleteEvalCase)).toHaveBeenCalledWith("case-1");
    });
    confirmSpy.mockRestore();
  });

  it("does not call deleteEvalCase when the user cancels the confirm dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    fireEvent.click(screen.getAllByLabelText("Delete case")[0]!);

    expect(confirmSpy).toHaveBeenCalled();
    expect(vi.mocked(deleteEvalCase)).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
