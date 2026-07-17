/*
 * StatsTab RTL tests.
 *
 * Asserts:
 * 1. Seeded agent stats render correctly (runs, accept_rate%, cost, latency,
 *    severity stacked bars with legend labels, labelled trend list).
 * 2. accept_rate: null → no-data glyph rendered with aria-label, NOT "0%",
 *    and no CircularScore ring badge (badge only renders when non-null).
 * 3. avg_cost_usd_prev: null → CostDelta renders "—".
 * 4. Loading state renders Skeleton placeholders and no numeric metrics.
 * 5. Error state renders the error message and no numeric metrics.
 * 6. Happy path — all new blocks render (Sparkline, CircularScore badge, CostDelta,
 *    SeverityStackedBars, CategoryDonut, RunHistoryTable).
 * 7. Clicking a Run History row's trace action opens RunTraceDrawer.
 * 8. Zero-run agent renders empty states across all new blocks without throwing.
 * 9. useAgentRuns error → Run History section shows error, stats cards still render.
 *
 * Uses fireEvent only — @testing-library/user-event is not installed
 * (client/INSIGHTS.md 2026-07-06).
 *
 * ResizeObserver is stubbed in the global test setup (src/test/setup.ts).
 * useAgentStats and useAgentRuns are mocked at the hook level.
 * RunTraceDrawer is mocked to avoid its internal hook dependencies.
 * next/link is mocked to a plain <a> element (no App Router needed in tests).
 */

import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import { StatsTab } from "./StatsTab";

// ---------------------------------------------------------------------------
// Module mocks (must come before imports that use them)
// ---------------------------------------------------------------------------

// next/link renders a plain <a> in the test environment
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <a href={href} style={style}>
      {children}
    </a>
  ),
}));

// RunTraceDrawer: mock the barrel (same path as the import in StatsTab.tsx)
vi.mock(
  "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer",
  () => ({
    default: ({
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

// Mock both agentPerformance hooks
vi.mock("@/lib/hooks/agentPerformance", () => ({
  useAgentStats: vi.fn(),
  useAgentRuns: vi.fn(),
}));

import { useAgentStats, useAgentRuns } from "@/lib/hooks/agentPerformance";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATS_WITH_DATA = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  runs: 42,
  findings_total: 127,
  accepted: 89,
  dismissed: 20,
  pending: 18,
  accept_rate: 0.816,
  dismiss_rate: 0.183,
  avg_findings_per_run: 3.02,
  total_cost_usd: 0.84,
  avg_cost_usd: 0.02,
  avg_latency_ms: 1350,
  findings_by_severity: { CRITICAL: 12, WARNING: 54, SUGGESTION: 61 },
  // New fields required by T6
  avg_cost_usd_prev: 0.025,
  severity_by_bucket: [
    { label: "Jun", CRITICAL: 12, WARNING: 54, SUGGESTION: 61 },
  ],
  cost_by_category: [{ category: "security", cost_usd: 0.015 }],
  trend: [
    { label: "2026-06-01", value: 5 },
    { label: "2026-06-08", value: 8 },
    { label: "2026-06-15", value: 12 },
  ],
};

/** Same as above but accept_rate is null — no accepted/dismissed actions yet. */
const STATS_NULL_ACCEPT_RATE = {
  ...STATS_WITH_DATA,
  accept_rate: null,
  dismiss_rate: null,
};

/** Stats with a null previous cost — CostDelta should render "—". */
const STATS_NULL_PREV_COST = {
  ...STATS_WITH_DATA,
  avg_cost_usd_prev: null,
};

/** Zero-runs stats — all aggregate fields null/empty. */
const STATS_ZERO_RUNS = {
  ...STATS_WITH_DATA,
  runs: 0,
  accept_rate: null,
  avg_cost_usd: null,
  avg_cost_usd_prev: null,
  avg_latency_ms: null,
  findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
  severity_by_bucket: [],
  cost_by_category: [],
  trend: [],
};

/** Happy-path run history with one row that has a trace. */
const RUNS_WITH_TRACE = {
  rows: [
    {
      run_id: "run-abc-123",
      ran_at: "2026-07-01T10:00:00.000Z",
      pr_number: null,
      pr_title: null,
      pr_repo_id: null,
      tokens_in: 1500,
      tokens_out: 450,
      cost_usd: 0.02,
      findings_count: 3,
      source: "local" as const,
      status: "completed",
      has_trace: true,
    },
  ],
  page: 1,
  limit: 25,
  total: 1,
};

const RUNS_EMPTY = {
  rows: [],
  page: 1,
  limit: 25,
  total: 0,
};

/**
 * Multi-page run list: total=60, limit=25 → totalPages=3.
 * Used to test pagination boundary behaviour (page 1 of 3).
 */
const RUNS_MULTI_PAGE = {
  rows: [
    {
      run_id: "run-page-test",
      ran_at: "2026-07-10T10:00:00.000Z",
      pr_number: null,
      pr_title: null,
      pr_repo_id: null,
      tokens_in: 500,
      tokens_out: 150,
      cost_usd: 0.01,
      findings_count: 1,
      source: "local" as const,
      status: "completed",
      has_trace: false,
    },
  ],
  page: 1,
  limit: 25,
  total: 60, // Math.ceil(60 / 25) = 3 pages
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderStatsTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      <StatsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// Provide a default useAgentRuns return value before every test so the
// unconditional hook call never returns undefined (which would crash on destructure).
beforeEach(() => {
  vi.mocked(useAgentRuns).mockReturnValue({
    data: RUNS_EMPTY,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAgentRuns>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Existing tests (must remain green)
// ---------------------------------------------------------------------------

describe("StatsTab — seeded data renders correctly", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("renders the runs count", () => {
    renderStatsTab();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders accept_rate as percentage when present", () => {
    renderStatsTab();
    // 0.816 × 100 → 82%; the MetricCard value
    expect(screen.getByText("82%")).toBeInTheDocument();
    // CircularScore badge renders the same rounded score, no "%" suffix, in its ring centre
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("renders avg_cost_usd via formatCost", () => {
    renderStatsTab();
    // formatCost(0.02) → "$0.02"
    expect(screen.getByText("$0.02")).toBeInTheDocument();
  });

  it("renders avg_latency_ms with ms unit", () => {
    renderStatsTab();
    expect(screen.getByText("1350 ms")).toBeInTheDocument();
  });

  it("renders findings_by_severity counts via SeverityStackedBars hidden table", () => {
    renderStatsTab();
    // Values appear in the visually-hidden data table inside SeverityStackedBars.
    // "12" also appears as the last trend-bar value, so use getAllByText.
    const twelves = screen.getAllByText("12");
    expect(twelves.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("54")).toBeInTheDocument(); // WARNING
    expect(screen.getByText("61")).toBeInTheDocument(); // SUGGESTION
  });

  it("renders severity legend labels from SeverityStackedBars", () => {
    renderStatsTab();
    // Labels appear in the legend and in the visually-hidden table header
    expect(screen.getAllByText("Critical").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Warning").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Suggestion").length).toBeGreaterThanOrEqual(1);
  });

  it("renders trend with both labels and values", () => {
    renderStatsTab();
    // Raw ISO labels are formatted as short UTC date/time, not shown verbatim.
    expect(screen.getByText("1 Jun 00:00")).toBeInTheDocument();
    expect(screen.getByText("8 Jun 00:00")).toBeInTheDocument();
    expect(screen.getByText("15 Jun 00:00")).toBeInTheDocument();
    // values
    const fives = screen.getAllByText("5");
    expect(fives.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("8")).toBeInTheDocument();
  });
});

describe("StatsTab — null accept_rate renders no-data glyph, not 0%", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_NULL_ACCEPT_RATE,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("renders the no-data glyph with an accessible label, not '0%'", () => {
    renderStatsTab();

    // Must NOT render "0%"
    expect(screen.queryByText("0%")).not.toBeInTheDocument();

    // Must render the no-data element with aria-label (MetricCard existing glyph)
    const noDataEl = screen.getByRole("img", { name: "no data yet" });
    expect(noDataEl).toBeInTheDocument();
    // The glyph itself is the "·" character defined in agents.json stats.noData
    expect(noDataEl).toHaveTextContent("·");

    // No CircularScore ring badge renders when accept_rate is null — the
    // badge is only passed when data.accept_rate != null (see StatsTab.tsx).
    expect(screen.queryByRole("img", { name: /accept rate/i })).toBeNull();
  });
});

describe("StatsTab — loading state", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("shows no fabricated numeric metrics while loading", () => {
    renderStatsTab();
    // No run count, no percentages, no cost
    expect(screen.queryByText("42")).not.toBeInTheDocument();
    expect(screen.queryByText("82%")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.02")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("StatsTab — error state", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("shows the error message and no numeric metrics", () => {
    renderStatsTab();
    expect(screen.getByText("Could not load agent stats.")).toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("StatsTab — empty state (zero runs)", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_ZERO_RUNS,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("shows the empty-period message, not metric tiles", () => {
    renderStatsTab();
    expect(
      screen.getByText("No runs in this period."),
    ).toBeInTheDocument();
    // No tile values rendered
    expect(screen.queryByText("RUNS")).not.toBeInTheDocument();
  });

  it("renders new blocks with empty states without throwing", () => {
    renderStatsTab();
    // SeverityStackedBars empty state
    expect(
      screen.getByText("No severity data for this period."),
    ).toBeInTheDocument();
    // CategoryDonut empty state
    expect(
      screen.getByText("No cost data by category for this period."),
    ).toBeInTheDocument();
    // RunHistoryTable empty state
    expect(
      screen.getByText("No runs recorded for this agent yet."),
    ).toBeInTheDocument();
  });
});

describe("StatsTab — tab routing (VALID_TABS sanity check)", () => {
  it("useAgentStats is called with agentId='ag1'", () => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);

    renderStatsTab();
    // Confirm hook received the correct agentId
    expect(vi.mocked(useAgentStats)).toHaveBeenCalledWith(
      "ag1",
      expect.objectContaining({ period: "30d" }),
    );
  });
});

// ---------------------------------------------------------------------------
// New tests (T6 acceptance)
// ---------------------------------------------------------------------------

describe("StatsTab — happy path: new blocks render with non-trivial data", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
    vi.mocked(useAgentRuns).mockReturnValue({
      data: RUNS_WITH_TRACE,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentRuns>);
  });

  it("Sparkline renders with aria-label describing the trend direction", () => {
    renderStatsTab();
    // Sparkline renders an SVG with role="img" and an aria-label about trend direction
    const sparkline = screen.getByRole("img", {
      name: /Trend: (upward|downward|flat)/i,
    });
    expect(sparkline).toBeInTheDocument();
  });

  it("accept-rate CircularScore badge renders the rounded score", () => {
    renderStatsTab();
    // CircularScore(score=82) renders "82" as visible text in its ring centre,
    // alongside the MetricCard's own "82%" value.
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("CostDelta renders a cost change indicator (not '—')", () => {
    renderStatsTab();
    // CostDelta(0.02, 0.025) → cheaper → shows "↓ -$0.005..." or similar glyph
    // We verify it does NOT show the null-data "—" (which would appear if both are null)
    // The delta text contains an arrow glyph
    const deltaEl = screen.getByText(/[↑↓→]/);
    expect(deltaEl).toBeInTheDocument();
  });

  it("SeverityStackedBars section header renders", () => {
    renderStatsTab();
    expect(screen.getByText("Findings by severity")).toBeInTheDocument();
  });

  it("CategoryDonut section header renders", () => {
    renderStatsTab();
    expect(screen.getByText("Findings by Category")).toBeInTheDocument();
  });

  it("RunHistoryTable section header renders", () => {
    renderStatsTab();
    expect(screen.getByText("Run History")).toBeInTheDocument();
  });

  it("RunHistoryTable renders a run row and its View trace button", () => {
    renderStatsTab();
    // The row's "View trace" button is present (has_trace: true)
    const traceBtn = screen.getByRole("button", {
      name: /View trace for run run-abc-123/i,
    });
    expect(traceBtn).toBeInTheDocument();
  });
});

describe("StatsTab — CostDelta null previous cost renders '—'", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_NULL_PREV_COST,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("CostDelta renders '—' when avg_cost_usd_prev is null", () => {
    renderStatsTab();
    // CostDelta(0.02, null) → renders "—" because previous is null
    // The "—" from CostDelta is the only "—" rendered (latency=1350ms, pr=null but no rows)
    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("StatsTab — trace drawer opens on row click", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
    vi.mocked(useAgentRuns).mockReturnValue({
      data: RUNS_WITH_TRACE,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentRuns>);
  });

  it("clicking View trace opens RunTraceDrawer with the correct runId", () => {
    renderStatsTab();

    // Drawer not visible initially
    expect(
      screen.queryByTestId("run-trace-drawer"),
    ).not.toBeInTheDocument();

    // Click the trace button for the row
    const traceBtn = screen.getByRole("button", {
      name: /View trace for run run-abc-123/i,
    });
    fireEvent.click(traceBtn);

    // Drawer should now be in the document with the correct runId
    const drawer = screen.getByTestId("run-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("data-run-id", "run-abc-123");
  });

  it("closing the RunTraceDrawer unmounts it", () => {
    renderStatsTab();

    const traceBtn = screen.getByRole("button", {
      name: /View trace for run run-abc-123/i,
    });
    fireEvent.click(traceBtn);

    // Drawer is now open
    expect(screen.getByTestId("run-trace-drawer")).toBeInTheDocument();

    // Click the mocked drawer's close button
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));

    // Drawer should be gone
    expect(
      screen.queryByTestId("run-trace-drawer"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pagination boundary tests (Finding 1 fix)
// ---------------------------------------------------------------------------

describe("StatsTab — RunHistoryTable pagination boundary behaviour", () => {
  /**
   * Both sub-suites need stats data with runs > 0 so the full StatsTab
   * renders (not the zero-run "No runs in this period" branch).
   * useAgentRuns returns RUNS_MULTI_PAGE (total: 60 → totalPages: 3).
   */
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
    vi.mocked(useAgentRuns).mockReturnValue({
      data: RUNS_MULTI_PAGE,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentRuns>);
  });

  it("at page 1 (first page), Prev is disabled and Next is enabled", () => {
    renderStatsTab();
    // StatsTab state starts at page=1; totalPages=3 → pagination controls render.
    const prevBtn = screen.getByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();
  });

  it("clicking Next advances to page 2 and calls useAgentRuns with page 2", () => {
    renderStatsTab();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    // StatsTab calls useAgentRuns(agentId, window, page, limit) on re-render.
    expect(vi.mocked(useAgentRuns)).toHaveBeenLastCalledWith(
      "ag1",
      expect.anything(),
      2,
      25,
    );
  });

  it("at the last page (3 of 3), Next is disabled and Prev is enabled", () => {
    renderStatsTab();
    // Advance from page 1 → page 2 → page 3 via two Next clicks.
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    // page=3, totalPages=3 → hasNext=false, hasPrev=true
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });
});

describe("StatsTab — run history error does not blank the whole tab", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
    vi.mocked(useAgentRuns).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAgentRuns>);
  });

  it("stats cards still render when run history query fails", () => {
    renderStatsTab();
    // Stats card values are still visible
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("$0.02")).toBeInTheDocument();
    // Run history shows its own error affordance
    expect(
      screen.getByText("Could not load run history."),
    ).toBeInTheDocument();
    // Stats error message is NOT shown
    expect(
      screen.queryByText("Could not load agent stats."),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PeriodSelector: custom range must not fire until Apply is clicked
// ---------------------------------------------------------------------------

describe("StatsTab — PeriodSelector custom range", () => {
  beforeEach(() => {
    vi.mocked(useAgentStats).mockReturnValue({
      data: STATS_WITH_DATA,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentStats>);
  });

  it("clicking 'Custom' reveals date inputs without querying yet", () => {
    const { container } = renderStatsTab();
    const callsBefore = vi.mocked(useAgentStats).mock.calls.length;

    fireEvent.click(screen.getByText("Custom"));

    // Date inputs are now visible...
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
    // ...but no new render was triggered by a window change — StatsTab still
    // holds the default 30d window (React state only updates local UI here).
    expect(vi.mocked(useAgentStats).mock.calls.length).toBe(callsBefore);
    const lastWindow = vi.mocked(useAgentStats).mock.calls.at(-1)?.[1];
    expect(lastWindow).toEqual({ period: "30d" });
  });

  it("filling both dates without clicking Apply still does not query", () => {
    const { container } = renderStatsTab();
    fireEvent.click(screen.getByText("Custom"));

    const [fromInput, toInput] = Array.from(
      container.querySelectorAll('input[type="date"]'),
    );
    fireEvent.change(fromInput!, { target: { value: "2026-06-01" } });
    fireEvent.change(toInput!, { target: { value: "2026-06-30" } });

    const lastWindow = vi.mocked(useAgentStats).mock.calls.at(-1)?.[1];
    expect(lastWindow).toEqual({ period: "30d" });
  });

  it("clicking Apply with both dates filled fires onChange with the custom window", () => {
    const { container } = renderStatsTab();
    fireEvent.click(screen.getByText("Custom"));

    const [fromInput, toInput] = Array.from(
      container.querySelectorAll('input[type="date"]'),
    );
    fireEvent.change(fromInput!, { target: { value: "2026-06-01" } });
    fireEvent.change(toInput!, { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByText("Apply"));

    const lastWindow = vi.mocked(useAgentStats).mock.calls.at(-1)?.[1];
    expect(lastWindow).toEqual({
      period: "custom",
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });
});
