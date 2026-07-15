/* MultiAgentResultsView — RTL + MSW tests (T5 acceptance criteria).
   Covers: N columns with score+status, SSE live flip, View-trace wiring,
   Tabs mode 5-action row, "did not flag" display, Show-only-conflicts toggle,
   and XSS-inert rendering of injected markup in conflict notes. */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun, FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../messages/en/runs.json";

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ runId: "run-parent-1" })),
}));

vi.mock("@/lib/hooks/multiAgent", () => ({
  useMultiAgentRun: vi.fn(),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(),
  useRunEvents: vi.fn(),
  useFindingAction: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  draftEvalCaseFromFinding: vi.fn().mockResolvedValue({
    title: "Draft",
    description: "",
    input_diff: "",
    input_meta: {},
    expected_output: { regions: [], must_not_flag: false },
  }),
  evalQueryKeys: {
    cases: (id: string) => ["eval-cases", id],
    batches: (id: string) => ["eval-batches", id],
    compare: (a: string, b: string, c: string) => ["eval-compare", a, b, c],
    dashboard: (id?: string) => ["eval-dashboard", id],
  },
  fetchEvalCases: vi.fn().mockResolvedValue([]),
}));

// Design-system primitives — stub all exports used by MultiAgentResultsView
vi.mock("@devdigest/ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    active,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} aria-pressed={active}>
      {children}
    </button>
  ),
  CircularScore: ({ score }: { score: number }) => (
    <span data-testid="circular-score">{score}</span>
  ),
  SeverityBadge: ({ severity }: { severity: string }) => (
    <span data-testid={`severity-${severity.toLowerCase()}`}>{severity}</span>
  ),
  Toggle: ({
    on,
    onChange,
  }: {
    on: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      data-testid="toggle"
    >
      toggle
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Skeleton: ({ height }: { height?: number }) => (
    <div data-testid="skeleton" style={{ height }} />
  ),
  ErrorState: ({ title }: { title: string }) => (
    <div role="alert">{title}</div>
  ),
  Icon: new Proxy(
    {},
    { get: () => () => <svg data-testid="icon" /> },
  ),
}));

// RunTraceDrawer — just tracks whether it was opened and with which runId
vi.mock(
  "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer",
  () => ({
    default: ({
      runId,
      onClose,
    }: {
      runId: string;
      agentName?: string | null;
      onClose: () => void;
    }) => (
      <div data-testid="run-trace-drawer" data-run-id={runId}>
        <button onClick={onClose}>Close drawer</button>
      </div>
    ),
    RunTraceDrawer: ({
      runId,
      onClose,
    }: {
      runId: string;
      onClose: () => void;
    }) => (
      <div data-testid="run-trace-drawer" data-run-id={runId}>
        <button onClick={onClose}>Close drawer</button>
      </div>
    ),
  }),
);

// EvalCaseModal — stub (not the focus of these tests)
vi.mock("@/components/EvalCaseModal", () => ({
  EvalCaseModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="eval-case-modal">
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}));

// SafeMarkdown — renders content as text; XSS test verifies no <img> in DOM
vi.mock("@/components/SafeMarkdown", () => ({
  SafeMarkdown: ({ content }: { content: string }) => (
    <span data-testid="safe-markdown">{content}</span>
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useMultiAgentRun } from "@/lib/hooks/multiAgent";
import {
  usePrReviews,
  useRunEvents,
  useFindingAction,
} from "@/lib/hooks/reviews";
import { MultiAgentResultsView } from "./MultiAgentResultsView";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FINDING_1: FindingRecord = {
  id: "f-1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 10,
  end_line: 12,
  rationale: "A secret key is committed.",
  suggestion: "Use environment variables.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rev-col-1",
  accepted_at: null,
  dismissed_at: null,
};

const FINDING_2: FindingRecord = {
  id: "f-2",
  severity: "WARNING",
  category: "perf",
  title: "N+1 query",
  file: "src/db.ts",
  start_line: 42,
  end_line: 42,
  rationale: "Loop executes a query per iteration.",
  suggestion: null,
  confidence: 0.7,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rev-col-2",
  accepted_at: null,
  dismissed_at: null,
};

/** A run with two agent columns (col-1 done, col-2 running) + one conflict. */
const RUN: MultiAgentRun = {
  id: "run-parent-1",
  pr_id: "pr-1",
  pr_number: 42,
  ran_at: "2026-07-15T10:00:00Z",
  agent_count: 2,
  total_duration_ms: 5000,
  total_cost_usd: 0.05,
  columns: [
    {
      run_id: "run-col-1",
      agent_id: "ag-1",
      agent_name: "Security Reviewer",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      status: "done",
      verdict: "request_changes",
      score: 72,
      summary: "Found a critical issue.",
      duration_ms: 2500,
      cost_usd: 0.03,
      findings: [
        {
          id: "f-col-1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded secret",
          file: "src/config.ts",
          start_line: 10,
          kind: null,
        },
      ],
    },
    {
      run_id: "run-col-2",
      agent_id: "ag-2",
      agent_name: "Style Checker",
      provider: "openai",
      model: "gpt-4o",
      status: "running",
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      findings: [],
    },
  ],
  conflicts: [
    {
      file: "src/config.ts",
      line: 10,
      title: "Hardcoded secret leak",
      takes: [
        {
          agent_id: "ag-1",
          persona: "Security Reviewer",
          verdict: "CRITICAL",
          note: "This is a critical security issue.",
        },
        {
          agent_id: "ag-2",
          persona: "Style Checker",
          verdict: "ignored",
          note: "",
        },
      ],
    },
    {
      // Unanimous conflict (both say WARNING) — hidden when filter is active
      file: "src/utils.ts",
      line: 5,
      title: "Duplicate code",
      takes: [
        {
          agent_id: "ag-1",
          persona: "Security Reviewer",
          verdict: "WARNING",
          note: "Duplicated logic.",
        },
        {
          agent_id: "ag-2",
          persona: "Style Checker",
          verdict: "WARNING",
          note: "Same warning.",
        },
      ],
    },
  ],
};

/** ReviewRecord with full FindingRecords for the first column. */
const REVIEW_COL_1: ReviewRecord = {
  id: "rev-col-1",
  pr_id: "pr-1",
  agent_id: "ag-1",
  run_id: "run-col-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: "Found a critical issue.",
  score: 72,
  model: "claude-3-5-sonnet",
  grounding: null,
  created_at: "2026-07-15T10:00:00Z",
  findings: [FINDING_1],
  tokens_in: null,
  tokens_out: null,
  cost_usd: 0.03,
};

/** ReviewRecord for the second column — empty findings. */
const REVIEW_COL_2: ReviewRecord = {
  id: "rev-col-2",
  pr_id: "pr-1",
  agent_id: "ag-2",
  run_id: "run-col-2",
  agent_name: "Style Checker",
  kind: "review",
  verdict: null,
  summary: null,
  score: null,
  model: "gpt-4o",
  grounding: null,
  created_at: "2026-07-15T10:00:00Z",
  findings: [],
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderView() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <MultiAgentResultsView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Default mock values
// ---------------------------------------------------------------------------

function setDefaultMocks() {
  vi.mocked(useMultiAgentRun).mockReturnValue({
    data: RUN,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useMultiAgentRun>);

  vi.mocked(usePrReviews).mockReturnValue({
    data: [REVIEW_COL_1, REVIEW_COL_2],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof usePrReviews>);

  vi.mocked(useRunEvents).mockReturnValue({
    events: [],
    running: false,
  });

  vi.mocked(useFindingAction).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    isIdle: true,
  } as unknown as ReturnType<typeof useFindingAction>);
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiAgentResultsView — Columns mode", () => {
  beforeEach(setDefaultMocks);

  it("renders N columns with agent name, score, and status indicator", () => {
    renderView();

    // Both agent names appear (may appear in column header + conflict persona)
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Style Checker").length).toBeGreaterThanOrEqual(1);

    // Score shown for the done column
    const scoreEl = screen.getByTestId("circular-score");
    expect(scoreEl).toHaveTextContent("72");

    // Status indicators (role="status") for both columns
    const statusEls = screen.getAllByRole("status");
    expect(statusEls.length).toBeGreaterThanOrEqual(2);

    // "Done" for col-1, "Running" for col-2
    const statusTexts = statusEls.map((el) => el.textContent ?? "");
    expect(statusTexts).toContain("Done");
    expect(statusTexts).toContain("Running");
  });

  it("flips a running column to Done when an SSE result event arrives (no manual refresh)", () => {
    // Initial: col-2 is running
    vi.mocked(useRunEvents).mockReturnValue({ events: [], running: true });

    const { rerender } = renderView();

    // Verify "Running" is shown for col-2
    const statusEls = screen.getAllByRole("status");
    const statusTexts = statusEls.map((el) => el.textContent ?? "");
    expect(statusTexts).toContain("Running");

    // Simulate SSE result event for run-col-2
    vi.mocked(useRunEvents).mockReturnValue({
      events: [
        {
          runId: "run-col-2",
          seq: 1,
          kind: "result",
          msg: "Review complete.",
          t: "5.0",
        },
      ],
      running: false,
    });

    // Rerender triggers hook re-call — no manual refresh needed
    rerender(
      <QueryClientProvider client={makeQC()}>
        <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
          <MultiAgentResultsView />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    // col-2 should now show "Done"
    const updatedStatuses = screen.getAllByRole("status").map((el) => el.textContent ?? "");
    expect(updatedStatuses).toContain("Done");
    expect(updatedStatuses).not.toContain("Running");
  });

  it("opens RunTraceDrawer with the correct run_id when 'View trace' is clicked", () => {
    renderView();

    // Before clicking: no drawer
    expect(screen.queryByTestId("run-trace-drawer")).not.toBeInTheDocument();

    // Click the first "View trace" button (col-1: run-col-1)
    const viewTraceButtons = screen.getAllByText("View trace");
    fireEvent.click(viewTraceButtons[0]!);

    // Drawer should appear with the correct run_id
    const drawer = screen.getByTestId("run-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("data-run-id", "run-col-1");
  });
});

describe("MultiAgentResultsView — Tabs mode", () => {
  beforeEach(setDefaultMocks);

  it("switches to tabs mode and shows the first agent's summary", () => {
    renderView();

    // Click "tabs" mode button
    fireEvent.click(screen.getByText("tabs"));

    // "Security Reviewer" appears (tab button + possibly conflict persona)
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThanOrEqual(1);
    // Summary appears in the tabs content area
    expect(screen.getByText("Found a critical issue.")).toBeInTheDocument();
  });

  it("expands a finding and shows the 5-action row", async () => {
    renderView();

    // Switch to tabs mode
    fireEvent.click(screen.getByText("tabs"));

    // The finding for ag-1 (FINDING_1: "Hardcoded secret") should be in the list
    // Click to expand it
    const findingTitle = screen.getByText("Hardcoded secret");
    // The finding is the collapsed header button — click the parent button
    const expandBtn = findingTitle.closest("button");
    expect(expandBtn).not.toBeNull();
    fireEvent.click(expandBtn!);

    // 5 action buttons must appear in the expanded body
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.getByText("Learn")).toBeInTheDocument();
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
    expect(screen.getByText("Reply to author")).toBeInTheDocument();
  });

  it("opens RunTraceDrawer from the tabs summary card 'View trace' button", () => {
    renderView();

    // Switch to tabs mode
    fireEvent.click(screen.getByText("tabs"));

    // "View trace" in the summary card
    const viewTraceBtns = screen.getAllByText("View trace");
    fireEvent.click(viewTraceBtns[0]!);

    const drawer = screen.getByTestId("run-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("data-run-id", "run-col-1");
  });
});

describe("MultiAgentResultsView — Where agents disagree", () => {
  beforeEach(setDefaultMocks);

  it("renders 'did not flag' for an 'ignored' take", () => {
    renderView();

    // The conflict for src/config.ts:10 has one 'ignored' take
    expect(screen.getByText("did not flag")).toBeInTheDocument();
  });

  it("does not render an empty note string as a bullet for ignored takes", () => {
    renderView();

    // The SafeMarkdown content for ignored takes should not appear
    // ('' note means: no note rendered)
    const safeMds = screen.getAllByTestId("safe-markdown");
    const contents = safeMds.map((el) => el.textContent ?? "");
    // None of the SafeMarkdown elements should contain only whitespace/empty
    // (this guards against rendering '' as a stray note)
    expect(contents.filter((c) => c === "")).toHaveLength(0);
  });

  it("hides unanimous conflict groups when 'Show only conflicts' is toggled on", () => {
    renderView();

    // Both conflicts are visible initially
    expect(screen.getByText("Hardcoded secret leak")).toBeInTheDocument();
    expect(screen.getByText("Duplicate code")).toBeInTheDocument();

    // Toggle "Show only conflicts"
    const toggle = screen.getByTestId("toggle");
    fireEvent.click(toggle);

    // Unanimous conflict (Duplicate code — both WARNING) should be hidden
    expect(screen.queryByText("Duplicate code")).not.toBeInTheDocument();

    // Mixed-stance conflict (Hardcoded secret leak — CRITICAL vs ignored) stays
    expect(screen.getByText("Hardcoded secret leak")).toBeInTheDocument();
  });

  it("renders injected markup in a conflict note as inert text, not executed HTML", () => {
    // Use a run with an injected <img> tag in a conflict note
    const injectedNote = '<img onerror="alert(1)" src="x">';
    const runWithXSS: MultiAgentRun = {
      ...RUN,
      conflicts: [
        {
          file: "src/evil.ts",
          line: 1,
          title: "XSS test",
          takes: [
            {
              agent_id: "ag-1",
              persona: "Attacker",
              verdict: "CRITICAL",
              note: injectedNote,
            },
          ],
        },
      ],
    };

    vi.mocked(useMultiAgentRun).mockReturnValue({
      data: runWithXSS,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useMultiAgentRun>);

    renderView();

    // SafeMarkdown mock renders content as text — no <img> element in DOM
    expect(document.querySelector("img")).toBeNull();

    // The raw string is present as text content (rendered inert)
    const safeMds = screen.getAllByTestId("safe-markdown");
    const hasInjected = safeMds.some((el) => el.textContent?.includes("<img"));
    expect(hasInjected).toBe(true);
  });
});

describe("MultiAgentResultsView — Loading / error states", () => {
  it("renders skeletons while loading", () => {
    vi.mocked(useMultiAgentRun).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useMultiAgentRun>);
    vi.mocked(usePrReviews).mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof usePrReviews>);
    vi.mocked(useRunEvents).mockReturnValue({ events: [], running: false });
    vi.mocked(useFindingAction).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useFindingAction>);

    renderView();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders error state when the run fails to load", () => {
    vi.mocked(useMultiAgentRun).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useMultiAgentRun>);
    vi.mocked(usePrReviews).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePrReviews>);
    vi.mocked(useRunEvents).mockReturnValue({ events: [], running: false });
    vi.mocked(useFindingAction).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useFindingAction>);

    renderView();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
