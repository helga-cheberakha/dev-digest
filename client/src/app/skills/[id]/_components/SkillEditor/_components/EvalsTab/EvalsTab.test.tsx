/*
 * EvalsTab RTL tests (TC3 + TC8 acceptance criteria).
 *
 * Asserts:
 * 1. One row per case rendered with a status icon reflecting latest_run.pass:
 *    - pass=true  → aria-label "passed"
 *    - pass=false → aria-label "failed"
 *    - null run   → aria-label "never run"
 * 2. The metrics strip renders recall/precision/citation/traces-passed tiles
 *    from fetchSkillEvalDashboard.
 * 3. Clicking "Run all evals" fires exactly one runSkillEvalBatch call.
 * 4. Row action icons fire runEvalCase / open the edit modal / deleteEvalCase
 *    (delete gated behind window.confirm).
 * 5. No "View full dashboard" link is present (skill tab does not have one).
 * 6. (TC8) Clicking "Benchmark vs no-skill" fires runSkillEvalBenchmark and
 *    renders the candidate/baseline tiles + lift values + per-case table.
 * 7. (TC8) Batch history renders one row per batch; selecting two rows and
 *    clicking "Compare selected" opens SkillCompareRunsModal.
 *
 * Uses fireEvent only — @testing-library/user-event is not installed
 * (client/INSIGHTS.md 2026-07-06).
 *
 * next-intl is provided via NextIntlClientProvider.
 * @tanstack/react-query is provided via QueryClientProvider.
 * EvalCaseModal and SkillCompareRunsModal are mocked to avoid rendering their
 * complex internals.
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
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import { EvalsTab } from "./EvalsTab";

// ---------------------------------------------------------------------------
// Mock @/lib/api
// ---------------------------------------------------------------------------
vi.mock("@/lib/api", () => ({
  fetchSkillEvalCases: vi.fn(),
  fetchSkillEvalDashboard: vi.fn(),
  fetchSkillEvalBatches: vi.fn(),
  fetchSkillEvalCompare: vi.fn(),
  runSkillEvalBatch: vi.fn(),
  runSkillEvalBenchmark: vi.fn(),
  runEvalCase: vi.fn(),
  deleteEvalCase: vi.fn(),
  evalQueryKeys: {
    skillCases: (skillId: string) => ["eval-cases", "skill", skillId] as const,
    skillDashboard: (skillId: string) => ["eval-dashboard", "skill", skillId] as const,
    skillBatches: (skillId: string) => ["eval-batches", "skill", skillId] as const,
    skillCompare: (skillId: string, a: string, b: string) =>
      ["eval-compare", "skill", skillId, a, b] as const,
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

// Mock SkillCompareRunsModal — mirrors the EvalCaseModal stub pattern.
vi.mock("./SkillCompareRunsModal", () => ({
  SkillCompareRunsModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="skill-compare-modal">
      <button onClick={onClose}>close-compare</button>
    </div>
  ),
}));

import {
  fetchSkillEvalCases,
  fetchSkillEvalDashboard,
  fetchSkillEvalBatches,
  runSkillEvalBatch,
  runSkillEvalBenchmark,
  runEvalCase,
  deleteEvalCase,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_PASSED = {
  id: "case-1",
  owner_kind: "skill" as const,
  owner_id: "sk1",
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
  owner_kind: "skill" as const,
  owner_id: "sk1",
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
  owner_kind: "skill" as const,
  owner_id: "sk1",
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

// EvalRun shape — matches the real server response for POST /skills/:id/eval-runs
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
  owner_kind: "skill" as const,
  owner_id: "sk1",
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

// Benchmark result: candidate_pass=true, baseline_pass=false for case-1
// so the per-case table shows the distinction (✓ vs ✗).
const BENCHMARK_RESULT = {
  candidate: {
    recall: 0.8,
    precision: 0.75,
    citation_accuracy: 0.9,
    traces_passed: 4,
    traces_total: 5,
    duration_ms: 2000,
    cost_usd: 0.05,
    per_trace: [],
  },
  baseline: {
    recall: 0.6,
    precision: 0.55,
    citation_accuracy: 0.7,
    traces_passed: 3,
    traces_total: 5,
    duration_ms: 1800,
    cost_usd: 0.04,
    per_trace: [],
  },
  delta: {
    recall: 0.2,
    precision: 0.2,
    citation_accuracy: 0.2,
  },
  per_case: [
    {
      case_id: "case-1",
      case_name: "stripe-key-leak",
      candidate_pass: true,
      baseline_pass: false,
    },
  ],
};

// Two batch history entries — used for the "Compare selected" test.
const BATCH_HISTORY = [
  {
    batch_id: "batch-1",
    ran_at: "2026-07-10T12:00:00Z",
    agent_version: 2,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    cost_usd: 0.1,
  },
  {
    batch_id: "batch-2",
    ran_at: "2026-07-09T10:00:00Z",
    agent_version: 1,
    recall: 0.75,
    precision: 0.8,
    citation_accuracy: 0.85,
    traces_passed: 15,
    traces_total: 20,
    cost_usd: 0.09,
  },
];

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
      <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
        <EvalsTab skillId="sk1" skillName="Security Rubric" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(fetchSkillEvalCases).mockResolvedValue([
    CASE_PASSED,
    CASE_FAILED,
    CASE_NEVER_RUN,
  ] as ReturnType<typeof fetchSkillEvalCases> extends Promise<infer T> ? T : never);
  vi.mocked(fetchSkillEvalDashboard).mockResolvedValue(DASHBOARD);
  vi.mocked(fetchSkillEvalBatches).mockResolvedValue([]);
  vi.mocked(runSkillEvalBatch).mockResolvedValue(BATCH_RESULT);
  vi.mocked(runSkillEvalBenchmark).mockResolvedValue(BENCHMARK_RESULT);
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

describe("EvalsTab (skill) — case list + pass/fail icons", () => {
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

describe("EvalsTab (skill) — metrics strip", () => {
  it("renders recall/precision/citation/traces-passed tiles from the dashboard", async () => {
    renderEvalsTab();
    expect(await screen.findByText("82%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
  });

  it("does NOT render a View full dashboard link (skill tab has no /eval/[skillId] page)", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");
    expect(screen.queryByRole("link", { name: /view full dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/view full dashboard/i)).not.toBeInTheDocument();
  });
});

describe("EvalsTab (skill) — Run all evals button", () => {
  it("fires exactly one runSkillEvalBatch call when the button is clicked", async () => {
    renderEvalsTab();

    // Wait for the tab to be fully rendered
    await screen.findByText("stripe-key-leak");

    const runBtn = screen.getByRole("button", { name: /run all evals/i });
    expect(runBtn).toBeInTheDocument();

    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(vi.mocked(runSkillEvalBatch)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runSkillEvalBatch)).toHaveBeenCalledWith("sk1");
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

describe("EvalsTab (skill) — per-row run/edit/delete actions", () => {
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

describe("EvalsTab (skill) — Benchmark vs no-skill (AC-20, AC-22)", () => {
  it("clicking the button fires runSkillEvalBenchmark once and renders candidate/baseline tiles + lift + per-case distinction", async () => {
    renderEvalsTab();
    await screen.findByText("stripe-key-leak");

    const benchBtn = screen.getByRole("button", { name: /benchmark vs no-skill/i });
    expect(benchBtn).toBeInTheDocument();

    fireEvent.click(benchBtn);

    await waitFor(() => {
      expect(vi.mocked(runSkillEvalBenchmark)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runSkillEvalBenchmark)).toHaveBeenCalledWith("sk1");
    });

    // Candidate tiles: 80%, 75%, 90% — unique from dashboard (82%, 91%, 95%)
    expect(await screen.findByText("80%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();

    // Baseline tiles: 60%, 55%, 70%
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();

    // Per-case distinction: candidate_pass=true → "✓", baseline_pass=false → "✗"
    expect(screen.getAllByText("✓").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("✗").length).toBeGreaterThanOrEqual(1);
  });
});

describe("EvalsTab (skill) — Batch history + Compare selected (AC-32)", () => {
  it("renders one row per batch and opens SkillCompareRunsModal when two are selected and Compare is clicked", async () => {
    vi.mocked(fetchSkillEvalBatches).mockResolvedValue(
      BATCH_HISTORY as ReturnType<typeof fetchSkillEvalBatches> extends Promise<infer T> ? T : never,
    );
    renderEvalsTab();

    // Wait for cases and batch history to load
    await screen.findByText("stripe-key-leak");
    // Batch rows show version labels
    expect(await screen.findByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();

    // Select both batch checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    // Click Compare selected — now 2 batches are selected so the button is enabled
    const compareBtn = screen.getByRole("button", { name: /compare selected/i });
    fireEvent.click(compareBtn);

    // The mocked SkillCompareRunsModal should open
    expect(screen.getByRole("dialog", { name: "skill-compare-modal" })).toBeInTheDocument();
  });
});
