/**
 * SummaryCards.test.tsx
 *
 * Verifies the two critical null-rendering rules:
 *   - avg_accept_rate: null → no-data glyph ("—"), NOT "0%"
 *   - total_cost_usd: null → "—", NOT "$0.00"
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryCards } from "./SummaryCards";
import type { AgentPerf } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSummary(
  overrides: Partial<AgentPerf["summary"]> = {},
): AgentPerf["summary"] {
  return {
    runs: 10,
    total_cost_usd: 1.23,
    avg_accept_rate: 0.75,
    most_active_agent: "security-agent",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SummaryCards", () => {
  it("renders a dash for null avg_accept_rate (not '0%')", () => {
    render(<SummaryCards summary={makeSummary({ avg_accept_rate: null })} />);

    // Must NOT show "0%" — null is not a zero accept rate
    expect(screen.queryByText("0%")).not.toBeInTheDocument();

    // Must show the no-data glyph at least once (for the accept rate card)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders a dash for null total_cost_usd (not '$0.00')", () => {
    render(<SummaryCards summary={makeSummary({ total_cost_usd: null })} />);

    // Must NOT show "$0.00" — null cost is missing data, not a free run
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();

    // Must show "—" for the cost card
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders formatted values when data is present", () => {
    render(
      <SummaryCards
        summary={makeSummary({
          runs: 42,
          total_cost_usd: 0,
          avg_accept_rate: 0.85,
          most_active_agent: "my-agent",
        })}
      />,
    );

    expect(screen.getByText("42")).toBeInTheDocument();
    // $0.00 for a genuine zero cost
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    // 85% for a present accept rate
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("my-agent")).toBeInTheDocument();
  });

  it("renders dash for null most_active_agent", () => {
    render(<SummaryCards summary={makeSummary({ most_active_agent: null })} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts all-null summary without throwing", () => {
    expect(() =>
      render(
        <SummaryCards
          summary={{
            runs: 0,
            total_cost_usd: null,
            avg_accept_rate: null,
            most_active_agent: null,
          }}
        />,
      ),
    ).not.toThrow();

    // runs=0 is a real value — should render "0", not "—"
    expect(screen.getByText("0")).toBeInTheDocument();
    // No "0%" — null accept rate
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    // No "$0.00" — null cost
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});
