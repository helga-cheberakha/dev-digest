import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChartTooltip } from "./LineChart";

afterEach(cleanup);

describe("ChartTooltip", () => {
  it("renders the label and detail line when active with a payload", () => {
    render(
      <ChartTooltip
        active
        payload={[{ payload: { __label: "5/29/2026, 9:14:00 AM", __detail: "v7 · $0.23" } }]}
      />,
    );

    expect(screen.getByText("5/29/2026, 9:14:00 AM")).toBeInTheDocument();
    expect(screen.getByText("v7 · $0.23")).toBeInTheDocument();
  });

  it("renders a \"—\" version fallback when the point's agent_version is null", () => {
    render(
      <ChartTooltip
        active
        payload={[{ payload: { __label: "5/27/2026, 4:40:00 PM", __detail: "— · $0.21" } }]}
      />,
    );

    expect(screen.getByText("— · $0.21")).toBeInTheDocument();
  });

  it("renders nothing when inactive", () => {
    const { container } = render(
      <ChartTooltip active={false} payload={[{ payload: { __label: "x", __detail: "y" } }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no payload", () => {
    const { container } = render(<ChartTooltip active payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders only the label when detail is omitted", () => {
    render(<ChartTooltip active payload={[{ payload: { __label: "just a label" } }]} />);
    expect(screen.getByText("just a label")).toBeInTheDocument();
  });
});
