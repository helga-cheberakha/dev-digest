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

// ---------------------------------------------------------------------------
// 2+ data points — path rendering and aria-label direction variants
// ---------------------------------------------------------------------------

describe("Sparkline — 2+ data points", () => {
  it("renders a <path> (not a <line>) for an upward trend", () => {
    render(
      <Sparkline
        points={[
          { label: "2026-07-01", value: 3 },
          { label: "2026-07-08", value: 7 },
          { label: "2026-07-15", value: 12 },
        ]}
      />,
    );

    const svg = screen.getByRole("img", { name: /upward/i });
    expect(svg).toBeInTheDocument();
    // 2+ points must render a path, not the fallback dashed line
    expect(svg.querySelector("path")).toBeInTheDocument();
    expect(svg.querySelector("line")).not.toBeInTheDocument();
  });

  it("aria-label contains 'upward' when the last value exceeds the first", () => {
    render(
      <Sparkline
        points={[
          { label: "2026-07-01", value: 2 },
          { label: "2026-07-08", value: 9 },
        ]}
      />,
    );

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-label",
      expect.stringContaining("upward"),
    );
  });

  it("aria-label contains 'downward' when the last value is less than the first", () => {
    render(
      <Sparkline
        points={[
          { label: "2026-07-01", value: 10 },
          { label: "2026-07-08", value: 4 },
        ]}
      />,
    );

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-label",
      expect.stringContaining("downward"),
    );
  });

  it("aria-label contains 'flat' when all values are equal", () => {
    render(
      <Sparkline
        points={[
          { label: "2026-07-01", value: 5 },
          { label: "2026-07-08", value: 5 },
          { label: "2026-07-15", value: 5 },
        ]}
      />,
    );

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-label",
      expect.stringContaining("flat"),
    );
  });

  it("aria-label contains 'downward' for exactly 2 points [3, 1]", () => {
    // 2 points is the minimal case for direction detection; last(1) < first(3) → downward.
    render(
      <Sparkline
        points={[
          { label: "2026-07-01", value: 3 },
          { label: "2026-07-08", value: 1 },
        ]}
      />,
    );

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-label",
      expect.stringContaining("downward"),
    );
  });

  it("aria-label contains 'flat' for exactly 2 equal points [5, 5]", () => {
    // 2 equal points is the minimal flat case; existing flat test uses 3 points.
    render(
      <Sparkline
        points={[
          { label: "2026-07-01", value: 5 },
          { label: "2026-07-08", value: 5 },
        ]}
      />,
    );

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-label",
      expect.stringContaining("flat"),
    );
  });
});
