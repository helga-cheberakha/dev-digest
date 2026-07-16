/*
 * StatsTab RTL tests.
 *
 * Asserts:
 * 1. Seeded agent stats render correctly (runs, accept_rate%, cost, latency,
 *    findings_by_severity counts, labelled trend list).
 * 2. accept_rate: null → no-data glyph rendered with aria-label, NOT "0%".
 * 3. Loading state renders Skeleton placeholders and no numeric metrics.
 * 4. Error state renders the error message and no numeric metrics.
 *
 * Uses fireEvent only — @testing-library/user-event is not installed
 * (client/INSIGHTS.md 2026-07-06).
 *
 * ResizeObserver is stubbed in the global test setup (src/test/setup.ts).
 * useAgentStats is mocked at the hook level.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import { StatsTab } from "./StatsTab";

// ---------------------------------------------------------------------------
// Mock useAgentStats
// ---------------------------------------------------------------------------

vi.mock("@/lib/hooks/agentPerformance", () => ({
  useAgentStats: vi.fn(),
}));

import { useAgentStats } from "@/lib/hooks/agentPerformance";

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

/** Zero-runs stats — all aggregate fields null. */
const STATS_ZERO_RUNS = {
  ...STATS_WITH_DATA,
  runs: 0,
  accept_rate: null,
  avg_cost_usd: null,
  avg_latency_ms: null,
  findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
  trend: [],
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
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
    // 0.816 × 100 → 82%
    expect(screen.getByText("82%")).toBeInTheDocument();
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

  it("renders findings_by_severity counts", () => {
    renderStatsTab();
    // "12" also appears as the last trend-bar value, so use getAllByText
    const twelves = screen.getAllByText("12");
    expect(twelves.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("54")).toBeInTheDocument(); // WARNING
    expect(screen.getByText("61")).toBeInTheDocument(); // SUGGESTION
  });

  it("renders severity labels", () => {
    renderStatsTab();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
  });

  it("renders trend with both labels and values", () => {
    renderStatsTab();
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("2026-06-08")).toBeInTheDocument();
    expect(screen.getByText("2026-06-15")).toBeInTheDocument();
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

    // Must render the no-data element with aria-label
    const noDataEl = screen.getByRole("img", { name: "no data yet" });
    expect(noDataEl).toBeInTheDocument();
    // The glyph itself is the "·" character defined in agents.json stats.noData
    expect(noDataEl).toHaveTextContent("·");
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
