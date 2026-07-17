/**
 * Sparkline.test.tsx
 *
 * Covers the 0–1 point fallback branch (dashed neutral line) that StatsTab
 * never exercises directly, since it suppresses the Sparkline entirely when
 * data.trend.length < 2.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders a dashed neutral line with a 'no trend data' label for 0 points", () => {
    render(<Sparkline points={[]} />);

    const svg = screen.getByRole("img", { name: "No trend data available" });
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("line")).toBeInTheDocument();
    expect(svg.querySelector("path")).not.toBeInTheDocument();
  });

  it("renders a dashed neutral line with a 'trend unavailable' label for 1 point", () => {
    render(<Sparkline points={[{ label: "2026-07-01", value: 5 }]} />);

    const svg = screen.getByRole("img", {
      name: "Only one data point — trend unavailable",
    });
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("line")).toBeInTheDocument();
    expect(svg.querySelector("path")).not.toBeInTheDocument();
  });
});
