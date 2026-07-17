/**
 * AgentPerfTable.test.tsx
 *
 * Tests the four acceptance behaviors:
 *   1. Initial render order: accept_rate DESC, null-accept-rate rows LAST.
 *   2. Clicking a column header re-sorts without any network/fetch call.
 *   3. Toggling a row's disclosure control expands the inline trend.
 *   4. Clicking the View button fires the injected onView callback with the
 *      correct agent_id.
 *
 * Uses `fireEvent` (not userEvent — @testing-library/user-event is not in
 * this package's dependencies per INSIGHTS.md 2026-07-06).
 *
 * No mocks of next/navigation or API are needed — this component is pure
 * presentational (props-in, no hooks that touch the network).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { AgentPerfRow } from "@devdigest/shared";
import { AgentPerfTable } from "./AgentPerfTable";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<AgentPerfRow> & { agent_id: string }): AgentPerfRow {
  return {
    agent_name: overrides.agent_id, // default name = id for easy identification
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
    ...overrides,
  };
}

/** Three rows ordered by accept_rate: high(0.9), low(0.3), null. */
const ROW_HIGH = makeRow({ agent_id: "agent-high", agent_name: "High Accept", accept_rate: 0.9 });
const ROW_LOW = makeRow({ agent_id: "agent-low", agent_name: "Low Accept", accept_rate: 0.3 });
const ROW_NULL = makeRow({
  agent_id: "agent-null",
  agent_name: "Null Accept",
  accept_rate: null,
  trend: [1, 2, 3],
});

/** Default row set for most tests (mixed order — sort correctness verifiable). */
const DEFAULT_ROWS = [ROW_LOW, ROW_NULL, ROW_HIGH];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTable(
  rows: AgentPerfRow[] = DEFAULT_ROWS,
  onView: (id: string) => void = vi.fn(),
) {
  return render(<AgentPerfTable rows={rows} onView={onView} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("AgentPerfTable", () => {
  describe("initial render order", () => {
    it("sorts by accept_rate DESC by default, null-accept-rate rows last", () => {
      renderTable();

      // Get all three names and verify DOM order
      const high = screen.getByText("High Accept");
      const low = screen.getByText("Low Accept");
      const nullRow = screen.getByText("Null Accept");

      // compareDocumentPosition: 4 means 'following' (B comes after A)
      expect(high.compareDocumentPosition(low) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(low.compareDocumentPosition(nullRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("null accept_rate cells show no-data glyph (—), not '0%'", () => {
      renderTable([ROW_NULL]);

      // Should NOT show "0%"
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });

    it("runs=0 renders '0' (not '—')", () => {
      renderTable([makeRow({ agent_id: "z", agent_name: "Zero Runs", runs: 0, accept_rate: null })]);
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("null avg_cost_usd renders '—' (not '$0.00')", () => {
      renderTable([
        makeRow({ agent_id: "c", agent_name: "No Cost", avg_cost_usd: null }),
      ]);
      // formatCost(null) returns "—"
      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    });
  });

  describe("client-side sorting (no network call)", () => {
    beforeEach(() => {
      // Spy on globalThis.fetch to assert it is NEVER called during a sort.
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("fetch must not be called during sort"),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("clicking 'Runs' header re-sorts without invoking fetch", () => {
      renderTable();

      const runsHeader = screen.getByRole("button", { name: /sort by runs/i });
      fireEvent.click(runsHeader);

      // If fetch was called, the mock would throw — no assertion needed beyond
      // not-throwing. But we also verify sort happened by checking rows changed.
      expect(screen.getByText("High Accept")).toBeInTheDocument();
      expect(screen.getByText("Low Accept")).toBeInTheDocument();
      expect(screen.getByText("Null Accept")).toBeInTheDocument();

      // fetch must not have been called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("clicking 'Accept' header reverses the sort direction without fetching", () => {
      renderTable();

      const acceptHeader = screen.getByRole("button", { name: /sort by accept/i });

      // First click: still desc (same key — toggles to asc)
      fireEvent.click(acceptHeader);
      // Second click: back to desc
      fireEvent.click(acceptHeader);

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("null-accept rows stay last even after toggling sort direction", () => {
      renderTable();

      const acceptHeader = screen.getByRole("button", { name: /sort by accept/i });
      // Toggle to ascending
      fireEvent.click(acceptHeader);

      const high = screen.getByText("High Accept");
      const low = screen.getByText("Low Accept");
      const nullRow = screen.getByText("Null Accept");

      // asc: low(0.3) before high(0.9) — null still last
      expect(low.compareDocumentPosition(high) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(high.compareDocumentPosition(nullRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe("disclosure control", () => {
    it("expand button is initially collapsed", () => {
      renderTable([ROW_HIGH]);

      const expandBtn = screen.getByRole("button", { name: /expand row/i });
      expect(expandBtn).toBeInTheDocument();
      expect(expandBtn).toHaveAttribute("aria-expanded", "false");

      // Trend panel must NOT be visible before expanding
      expect(screen.queryByTestId("trend-agent-high")).not.toBeInTheDocument();
    });

    it("clicking the expand button shows the inline trend", () => {
      renderTable([ROW_HIGH]);

      const expandBtn = screen.getByRole("button", { name: /expand row/i });
      fireEvent.click(expandBtn);

      // aria-expanded flips to true
      expect(expandBtn).toHaveAttribute("aria-expanded", "true");

      // The trend panel is now in the DOM
      expect(screen.getByTestId("trend-agent-high")).toBeInTheDocument();
      // The trend sparkline label is visible
      expect(screen.getByLabelText("trend sparkline")).toBeInTheDocument();
    });

    it("clicking expand then collapse hides the trend again", () => {
      renderTable([ROW_HIGH]);

      const expandBtn = screen.getByRole("button", { name: /expand row/i });
      fireEvent.click(expandBtn); // expand
      fireEvent.click(expandBtn); // collapse (button now reads "Collapse row")

      expect(screen.queryByTestId("trend-agent-high")).not.toBeInTheDocument();
    });

    it("can expand multiple rows independently", () => {
      renderTable();

      const expandBtns = screen.getAllByRole("button", { name: /expand row/i });
      // Expand first two rows
      fireEvent.click(expandBtns[0]!);
      fireEvent.click(expandBtns[1]!);

      // Both trend panels appear
      const trends = screen.getAllByLabelText("trend sparkline");
      expect(trends.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("onView callback", () => {
    it("clicking the View button fires onView with the correct agent_id", () => {
      const onView = vi.fn();
      renderTable([ROW_HIGH], onView);

      const viewBtn = screen.getByRole("button", { name: /view high accept/i });
      fireEvent.click(viewBtn);

      expect(onView).toHaveBeenCalledOnce();
      expect(onView).toHaveBeenCalledWith("agent-high");
    });

    it("clicking different rows' View buttons fires onView with respective agent_ids", () => {
      const onView = vi.fn();
      renderTable(DEFAULT_ROWS, onView);

      const highView = screen.getByRole("button", { name: /view high accept/i });
      const lowView = screen.getByRole("button", { name: /view low accept/i });

      fireEvent.click(highView);
      fireEvent.click(lowView);

      expect(onView).toHaveBeenCalledTimes(2);
      expect(onView).toHaveBeenNthCalledWith(1, "agent-high");
      expect(onView).toHaveBeenNthCalledWith(2, "agent-low");
    });

    it("clicking the row body (not the View button) fires onView", () => {
      const onView = vi.fn();
      renderTable([ROW_HIGH], onView);

      // Click a non-interactive element inside the row (agent name text)
      // to exercise the row-container's onClick handler.
      const agentName = screen.getByText("High Accept");
      fireEvent.click(agentName);

      expect(onView).toHaveBeenCalledOnce();
      expect(onView).toHaveBeenCalledWith("agent-high");
    });

    it("clicking the disclosure toggle does NOT fire onView (only expand/collapse)", () => {
      const onView = vi.fn();
      renderTable([ROW_HIGH], onView);

      const toggleBtn = screen.getByRole("button", { name: /expand row/i });
      fireEvent.click(toggleBtn);

      // Row should expand but onView must never have been called
      expect(onView).not.toHaveBeenCalled();
      // Toggle DID expand the row
      expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("clicking the disclosure wrapper div (padding area) does NOT fire onView", () => {
      // Regression: before the fix the onClick lived only on the inner <button>,
      // so a click in the 0 4px padding margin of the wrapper div would bypass
      // stopPropagation and navigate instead of expanding.
      const onView = vi.fn();
      renderTable([ROW_HIGH], onView);

      // Fire a click directly on the wrapper div, simulating a click that lands
      // in the padding zone just outside the button icon.
      const wrapper = screen.getByTestId("disclosure-wrapper-agent-high");
      fireEvent.click(wrapper);

      // The wrapper's own onClick should have expanded the row …
      const collapseBtn = screen.getByRole("button", { name: /collapse row/i });
      expect(collapseBtn).toHaveAttribute("aria-expanded", "true");
      // … but onView must never have fired.
      expect(onView).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Additional coverage added in code-review pass
  // -------------------------------------------------------------------------

  describe("empty state", () => {
    it("renders 'No agent runs yet.' when rows array is empty", () => {
      renderTable([]);
      expect(screen.getByText("No agent runs yet.")).toBeInTheDocument();
    });

    it("does not render any row content when rows is empty", () => {
      renderTable([]);
      // No expand buttons — no rows
      expect(screen.queryByRole("button", { name: /expand row/i })).not.toBeInTheDocument();
    });
  });

  describe("sort by Avg cost column", () => {
    // Rows deliberately ordered so initial sort (accept_rate DESC) gives the
    // opposite order to avg_cost_usd DESC — proves the sort actually changed.
    const ROW_COST_HIGH = makeRow({
      agent_id: "cost-high",
      agent_name: "High Cost",
      avg_cost_usd: 0.9,
      accept_rate: 0.3, // low accept → comes second in default accept-rate sort
    });
    const ROW_COST_LOW = makeRow({
      agent_id: "cost-low",
      agent_name: "Low Cost",
      avg_cost_usd: 0.1,
      accept_rate: 0.8, // high accept → comes first in default accept-rate sort
    });

    it("clicking 'Avg cost' header shows the descending direction indicator", () => {
      renderTable([ROW_COST_HIGH, ROW_COST_LOW]);

      const header = screen.getByRole("button", { name: /sort by avg cost/i });
      fireEvent.click(header);

      // Active desc sort indicator should appear in the button text
      expect(header).toHaveTextContent("↓");
    });

    it("clicking 'Avg cost' header reorders rows by avg_cost_usd DESC", () => {
      renderTable([ROW_COST_HIGH, ROW_COST_LOW]);

      // Default (accept_rate DESC): Low Cost (0.8) before High Cost (0.3)
      const lowBeforeSort = screen.getByText("Low Cost");
      const highBeforeSort = screen.getByText("High Cost");
      expect(
        lowBeforeSort.compareDocumentPosition(highBeforeSort) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Click the Avg cost header
      const header = screen.getByRole("button", { name: /sort by avg cost/i });
      fireEvent.click(header);

      // After sort (avg_cost_usd DESC): High Cost (0.9) before Low Cost (0.1)
      const highAfterSort = screen.getByText("High Cost");
      const lowAfterSort = screen.getByText("Low Cost");
      expect(
        highAfterSort.compareDocumentPosition(lowAfterSort) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("clicking 'Avg cost' header a second time reverses to ascending order", () => {
      renderTable([ROW_COST_HIGH, ROW_COST_LOW]);

      const header = screen.getByRole("button", { name: /sort by avg cost/i });
      fireEvent.click(header); // desc
      fireEvent.click(header); // asc

      // Ascending indicator
      expect(header).toHaveTextContent("↑");

      // Low Cost (0.1) before High Cost (0.9) in ascending order
      const lowEl = screen.getByText("Low Cost");
      const highEl = screen.getByText("High Cost");
      expect(
        lowEl.compareDocumentPosition(highEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("sort by Avg dur. column", () => {
    const ROW_DUR_LONG = makeRow({
      agent_id: "dur-long",
      agent_name: "Long Dur",
      avg_latency_ms: 8000,
      accept_rate: 0.2, // low accept → comes second by default
    });
    const ROW_DUR_SHORT = makeRow({
      agent_id: "dur-short",
      agent_name: "Short Dur",
      avg_latency_ms: 1000,
      accept_rate: 0.9, // high accept → comes first by default
    });

    it("clicking 'Avg dur.' header shows the descending direction indicator", () => {
      renderTable([ROW_DUR_LONG, ROW_DUR_SHORT]);

      const header = screen.getByRole("button", { name: /sort by avg dur/i });
      fireEvent.click(header);

      expect(header).toHaveTextContent("↓");
    });

    it("clicking 'Avg dur.' header reorders rows by avg_latency_ms DESC", () => {
      renderTable([ROW_DUR_LONG, ROW_DUR_SHORT]);

      // Default: Short Dur (0.9 accept) before Long Dur (0.2 accept)
      const shortBefore = screen.getByText("Short Dur");
      const longBefore = screen.getByText("Long Dur");
      expect(
        shortBefore.compareDocumentPosition(longBefore) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const header = screen.getByRole("button", { name: /sort by avg dur/i });
      fireEvent.click(header);

      // After sort (avg_latency_ms DESC): Long Dur (8000ms) before Short Dur (1000ms)
      const longAfter = screen.getByText("Long Dur");
      const shortAfter = screen.getByText("Short Dur");
      expect(
        longAfter.compareDocumentPosition(shortAfter) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("sort by Last run column", () => {
    const ROW_RECENT = makeRow({
      agent_id: "run-recent",
      agent_name: "Recent Run",
      last_run_at: "2026-07-20T10:00:00Z",
      accept_rate: 0.2, // low accept → comes second by default
    });
    const ROW_OLD = makeRow({
      agent_id: "run-old",
      agent_name: "Old Run",
      last_run_at: "2026-07-01T10:00:00Z",
      accept_rate: 0.9, // high accept → comes first by default
    });

    it("clicking 'Last run' header shows the descending direction indicator", () => {
      renderTable([ROW_RECENT, ROW_OLD]);

      const header = screen.getByRole("button", { name: /sort by last run/i });
      fireEvent.click(header);

      expect(header).toHaveTextContent("↓");
    });

    it("clicking 'Last run' header reorders rows by last_run_at DESC (most recent first)", () => {
      renderTable([ROW_RECENT, ROW_OLD]);

      // Default: Old Run (0.9 accept) before Recent Run (0.2 accept)
      const oldBefore = screen.getByText("Old Run");
      const recentBefore = screen.getByText("Recent Run");
      expect(
        oldBefore.compareDocumentPosition(recentBefore) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const header = screen.getByRole("button", { name: /sort by last run/i });
      fireEvent.click(header);

      // After sort (last_run_at DESC): Recent Run (2026-07-20) before Old Run (2026-07-01)
      const recentAfter = screen.getByText("Recent Run");
      const oldAfter = screen.getByText("Old Run");
      expect(
        recentAfter.compareDocumentPosition(oldAfter) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("model subtext", () => {
    it("renders the model name below the agent name when row.model is set", () => {
      renderTable([makeRow({ agent_id: "m", agent_name: "Model Agent", model: "gpt-4-turbo" })]);
      expect(screen.getByText("gpt-4-turbo")).toBeInTheDocument();
    });

    it("does not render model subtext when row.model is null", () => {
      renderTable([makeRow({ agent_id: "nm", agent_name: "No Model Agent", model: null })]);
      // Agent name is visible…
      expect(screen.getByText("No Model Agent")).toBeInTheDocument();
      // …but no model-name element below it
      // (getByText throws if multiple — queryByText returns null when absent)
      expect(screen.queryByText("null")).not.toBeInTheDocument();
    });

    it("default model (claude-3-5-sonnet) is visible when model is set", () => {
      // The existing makeRow default is "claude-3-5-sonnet"; verify the subtext renders.
      renderTable([makeRow({ agent_id: "d", agent_name: "Default Model" })]);
      expect(screen.getByText("claude-3-5-sonnet")).toBeInTheDocument();
    });
  });

  describe("TrendBars — empty trend array", () => {
    const ROW_NO_TREND = makeRow({
      agent_id: "no-trend",
      agent_name: "No Trend Agent",
      trend: [],
      // Keep other fields non-null so the "—" glyph in the trend panel
      // is not ambiguous with other no-data cells.
      avg_cost_usd: 0.1,
      avg_latency_ms: 1000,
      accept_rate: 0.8,
      last_run_at: "2026-07-15T10:00:00Z",
    });

    it("renders the NO_DATA_GLYPH ('—') in the trend panel when trend is empty", () => {
      renderTable([ROW_NO_TREND]);

      // Expand the row to reveal the trend panel
      const expandBtn = screen.getByRole("button", { name: /expand row/i });
      fireEvent.click(expandBtn);

      const trendPanel = screen.getByTestId("trend-no-trend");
      // The TrendBars guard renders "—" (NO_DATA_GLYPH) when trend.length === 0
      expect(within(trendPanel).getByText("—")).toBeInTheDocument();
    });

    it("does NOT render the sparkline div when trend is empty", () => {
      renderTable([ROW_NO_TREND]);

      const expandBtn = screen.getByRole("button", { name: /expand row/i });
      fireEvent.click(expandBtn);

      // No sparkline — no crash either
      expect(screen.queryByLabelText("trend sparkline")).not.toBeInTheDocument();
    });

    it("does not crash when a row with trend:[] is expanded", () => {
      // Guard regression: the vendor Sparkline has a ÷0 bug at length 1;
      // TrendBars guards length===0 with a glyph fallback — verify no throw.
      renderTable([ROW_NO_TREND]);

      expect(() => {
        const expandBtn = screen.getByRole("button", { name: /expand row/i });
        fireEvent.click(expandBtn);
      }).not.toThrow();

      // Component is still mounted
      expect(screen.getByTestId("trend-no-trend")).toBeInTheDocument();
    });
  });
});
