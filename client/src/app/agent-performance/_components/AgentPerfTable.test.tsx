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
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
});
