/**
 * AgentPerformanceView.test.tsx
 *
 * Acceptance tests:
 *   1. Default period is `{period:'30d'}` — useAgentPerformance called with it on mount.
 *   2. Switching the period picker calls useAgentPerformance with the new window.
 *   3. `summary.runs === 0` → single whole-dashboard empty state; cards/table/donuts absent.
 *   4. Loading state → skeleton affordance; no numeric metric text ("0", "0%", "$0.00").
 *   5. Error state → error affordance; no numeric metric text.
 *   6. Interacting with the picker never triggers a non-GET network call.
 *
 * Uses `fireEvent` (not userEvent — @testing-library/user-event is not in
 * this package's dependencies; INSIGHTS.md 2026-07-06).
 *
 * Mocking strategy:
 *   - `useAgentPerformance` mocked at the hook level (vi.mock + vi.mocked).
 *   - SummaryCards / AgentPerfTable / CostBreakdown mocked as lightweight stubs
 *     (they are independently tested in T5; here we only test AgentPerformanceView's
 *     orchestration).
 *   - AppShell mocked as a passthrough.
 *   - @devdigest/ui mocked with only the exports AgentPerformanceView imports (Skeleton).
 *   - next-intl NOT mocked — real NextIntlClientProvider is used instead.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerf } from "@devdigest/shared";

// Import the agentPerformance messages for the provider
import agentPerfMessages from "../../../../messages/en/agentPerformance.json";

// ---------------------------------------------------------------------------
// Mocks (hoisted by Vitest before imports)
// ---------------------------------------------------------------------------

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Only Skeleton is used by AgentPerformanceView itself. Listing it here avoids the
// "Element type is invalid" crash described in INSIGHTS.md (2026-07-11) when the
// factory omits any import the subtree actually needs.
vi.mock("@devdigest/ui", () => ({
  Skeleton: ({ height }: { height: number }) => (
    <div data-testid="skeleton" aria-hidden="true" style={{ height }} />
  ),
}));

// Stub the three presentational components — they are tested independently in T5.
vi.mock("./SummaryCards", () => ({
  SummaryCards: ({ summary }: { summary: AgentPerf["summary"] }) => (
    <div data-testid="summary-cards">runs:{summary.runs}</div>
  ),
}));

vi.mock("./AgentPerfTable", () => ({
  AgentPerfTable: ({
    rows,
    onView,
  }: {
    rows: AgentPerf["agents"];
    onView: (id: string) => void;
  }) => (
    <div data-testid="agent-table">
      {rows.map((r) => (
        <button key={r.agent_id} onClick={() => onView(r.agent_id)}>
          view-{r.agent_id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./CostBreakdown", () => ({
  CostBreakdown: () => <div data-testid="cost-breakdown" />,
}));

// Mock the hook so tests control its return value without QueryClient
vi.mock("@/lib/hooks/agentPerformance", () => ({
  useAgentPerformance: vi.fn(),
}));

// Imports AFTER vi.mock so Vitest's hoisting gives us the mocked module
import { useAgentPerformance } from "@/lib/hooks/agentPerformance";
import { AgentPerformanceView } from "./AgentPerformanceView";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgentPerfRow(agentId: string): AgentPerf["agents"][number] {
  return {
    agent_id: agentId,
    agent_name: `Agent ${agentId}`,
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    runs: 5,
    findings_total: 10,
    accepted: 7,
    dismissed: 3,
    accept_rate: 0.7,
    dismiss_rate: 0.3,
    avg_findings_per_run: 2,
    total_cost_usd: 0.5,
    avg_cost_usd: 0.1,
    avg_latency_ms: 2000,
    last_run_at: "2026-07-15T10:00:00Z",
    findings_by_severity: { CRITICAL: 1, WARNING: 5, SUGGESTION: 4 },
    trend: [2, 3, 1, 4, 2],
  };
}

function makePerf(overrides: Partial<AgentPerf> = {}): AgentPerf {
  return {
    summary: {
      runs: 10,
      total_cost_usd: 1.23,
      avg_accept_rate: 0.75,
      most_active_agent: "security-agent",
    },
    agents: [makeAgentPerfRow("agent-1")],
    cost_by_agent: [{ label: "security-agent", value: 1.23 }],
    cost_by_model: [{ label: "claude-3-5-sonnet", value: 1.23 }],
    ...overrides,
  };
}

/** Zero-runs dataset — triggers the whole-dashboard empty state. */
function makeEmptyPerf(): AgentPerf {
  return makePerf({
    summary: {
      runs: 0,
      total_cost_usd: null,
      avg_accept_rate: null,
      most_active_agent: null,
    },
    agents: [],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUseAgentPerformance = vi.mocked(useAgentPerformance);

type HookReturn = {
  data: AgentPerf | undefined;
  isLoading: boolean;
  isError: boolean;
};

function mockHook(value: HookReturn) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockUseAgentPerformance.mockReturnValue(value as any);
}

function renderView() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agentPerformance: agentPerfMessages }}
    >
      <AgentPerformanceView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentPerformanceView", () => {
  describe("default period", () => {
    it("calls useAgentPerformance with {period:'30d'} by default", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      expect(mockUseAgentPerformance).toHaveBeenCalledWith({ period: "30d" });
    });

    it("renders the period picker button showing the '30 days' label on first render", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      // The trigger button shows the current period label
      expect(
        screen.getByRole("button", { name: /30 days/i }),
      ).toBeInTheDocument();
    });
  });

  describe("period switching", () => {
    it("calls useAgentPerformance with {period:'1d'} after selecting '1 day'", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      // Open the period picker dropdown
      fireEvent.click(screen.getByRole("button", { name: /30 days/i }));

      // Select the "1 day" option (role="option" is set on option elements)
      fireEvent.click(screen.getByRole("option", { name: /1 day/i }));

      // useAgentPerformance must have been called with the new window
      expect(mockUseAgentPerformance).toHaveBeenLastCalledWith({ period: "1d" });
    });

    it("keeps the data sections visible after a period change (runs > 0)", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      fireEvent.click(screen.getByRole("button", { name: /30 days/i }));
      fireEvent.click(screen.getByRole("option", { name: /1 day/i }));

      // The hook still returns runs > 0, so sections remain
      expect(screen.getByTestId("perf-summary-cards")).toBeInTheDocument();
      expect(screen.getByTestId("perf-agent-table")).toBeInTheDocument();
      expect(screen.getByTestId("perf-cost-breakdown")).toBeInTheDocument();
    });

    it("reveals date inputs and Apply button when 'Custom range' is selected", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      fireEvent.click(screen.getByRole("button", { name: /30 days/i }));
      fireEvent.click(screen.getByRole("option", { name: /custom range/i }));

      // Date inputs appear inside the still-open dropdown (queried by aria-label)
      expect(screen.getByLabelText(/from/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
      // "Apply" button should now be visible
      expect(
        screen.getByRole("button", { name: /apply/i }),
      ).toBeInTheDocument();
    });

    it("calls useAgentPerformance with custom window after filling dates and clicking Apply", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      fireEvent.click(screen.getByRole("button", { name: /30 days/i }));
      fireEvent.click(screen.getByRole("option", { name: /custom range/i }));

      // Fill in the From and To date inputs (queried by aria-label)
      const fromEl = screen.getByLabelText(/from/i);
      const toEl = screen.getByLabelText(/to/i);

      fireEvent.change(fromEl, { target: { value: "2026-07-01" } });
      fireEvent.change(toEl, { target: { value: "2026-07-17" } });

      fireEvent.click(screen.getByRole("button", { name: /apply/i }));

      expect(mockUseAgentPerformance).toHaveBeenLastCalledWith({
        period: "custom",
        from: "2026-07-01",
        to: "2026-07-17",
      });
    });
  });

  describe("empty state (summary.runs === 0)", () => {
    it("renders the whole-dashboard empty state, NOT cards/table/donuts", () => {
      mockHook({ data: makeEmptyPerf(), isLoading: false, isError: false });
      renderView();

      expect(screen.getByTestId("perf-empty")).toBeInTheDocument();
      expect(screen.queryByTestId("perf-summary-cards")).not.toBeInTheDocument();
      expect(screen.queryByTestId("perf-agent-table")).not.toBeInTheDocument();
      expect(screen.queryByTestId("perf-cost-breakdown")).not.toBeInTheDocument();
    });

    it("empty state contains the expected title message", () => {
      mockHook({ data: makeEmptyPerf(), isLoading: false, isError: false });
      renderView();

      expect(
        screen.getByText(agentPerfMessages.empty.title),
      ).toBeInTheDocument();
    });

    it("empty state does NOT render any numeric metric (no '0%' or '$0.00')", () => {
      mockHook({ data: makeEmptyPerf(), isLoading: false, isError: false });
      renderView();

      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("renders the loading affordance (skeleton) when isLoading is true", () => {
      mockHook({ data: undefined, isLoading: true, isError: false });
      renderView();

      expect(screen.getByTestId("perf-loading")).toBeInTheDocument();
      expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    });

    it("does not render any numeric metric text during loading", () => {
      mockHook({ data: undefined, isLoading: true, isError: false });
      renderView();

      // No metric-like values must appear in the loading UI
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
      // Cards/table/breakdown must be absent
      expect(screen.queryByTestId("perf-summary-cards")).not.toBeInTheDocument();
      expect(screen.queryByTestId("perf-agent-table")).not.toBeInTheDocument();
      expect(screen.queryByTestId("perf-cost-breakdown")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders the error affordance (role=alert) when isError is true", () => {
      mockHook({ data: undefined, isLoading: false, isError: true });
      renderView();

      expect(screen.getByTestId("perf-error")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("does not render any numeric metric text during error", () => {
      mockHook({ data: undefined, isLoading: false, isError: true });
      renderView();

      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
      expect(screen.queryByTestId("perf-summary-cards")).not.toBeInTheDocument();
      expect(screen.queryByTestId("perf-agent-table")).not.toBeInTheDocument();
    });

    it("shows the loadError message", () => {
      mockHook({ data: undefined, isLoading: false, isError: true });
      renderView();

      expect(
        screen.getByText(agentPerfMessages.loadError),
      ).toBeInTheDocument();
    });
  });

  describe("navigation — onView callback", () => {
    it("calls router.push with /agents/:id?tab=stats when View is clicked", () => {
      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      // The stubbed AgentPerfTable renders a "view-agent-1" button
      fireEvent.click(screen.getByRole("button", { name: /view-agent-1/i }));

      expect(mockPush).toHaveBeenCalledWith("/agents/agent-1?tab=stats");
    });
  });

  describe("no mutation / no non-GET requests", () => {
    it("never triggers a network fetch when interacting with the period picker", () => {
      // Spy on globalThis.fetch — all data-fetching goes through the mocked hook,
      // so fetch should never be called at all during UI interaction.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("fetch must not be called during picker interaction");
      });

      mockHook({ data: makePerf(), isLoading: false, isError: false });
      renderView();

      // Open dropdown and change period
      fireEvent.click(screen.getByRole("button", { name: /30 days/i }));
      fireEvent.click(screen.getByRole("option", { name: /1 day/i }));

      // fetch must not have been called (no mutation, no accidental review trigger)
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
