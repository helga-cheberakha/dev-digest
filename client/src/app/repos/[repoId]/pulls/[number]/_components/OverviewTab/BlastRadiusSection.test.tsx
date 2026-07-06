import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrBlast: vi.fn(),
}));

import { usePrBlast } from "../../../../../../../lib/hooks/brief";
import { BlastRadiusSection } from "./BlastRadiusSection";

afterEach(cleanup);

const BLAST: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }],
      endpoints_affected: ["GET /public/data"],
      crons_affected: [],
    },
  ],
  summary: "1 symbol(s) changed · 1 caller(s) · 1 endpoint(s) affected.",
};

const BLAST_WITH_PRIOR: BlastRadius = {
  ...BLAST,
  prior_prs: [
    {
      id: "1",
      number: 42,
      title: "Fix",
      opened_at: "2026-01-01T00:00:00.000Z",
      status: "merged",
    },
  ],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusSection", () => {
  beforeEach(() => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: undefined,
    } as any);
  });

  it("renders Skeleton while loading", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    } as any);
    const { container } = renderWithIntl(
      <BlastRadiusSection prId="pr1" onGoToBlast={vi.fn()} />,
    );
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });

  it("renders compact count summary when blast data arrives", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST,
    } as any);
    renderWithIntl(
      <BlastRadiusSection prId="pr1" onGoToBlast={vi.fn()} />,
    );
    expect(screen.queryByText("rateLimit()")).not.toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
  });

  it("renders PriorPrsAccordion when prior_prs is non-empty and shows PR title on toggle", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST_WITH_PRIOR,
    } as any);
    renderWithIntl(
      <BlastRadiusSection prId="pr1" onGoToBlast={vi.fn()} />,
    );
    // Accordion header is visible
    expect(screen.getByText("Prior PRs touching these files")).toBeInTheDocument();
    // PR title is not visible before expanding
    expect(screen.queryByText("Fix")).not.toBeInTheDocument();
    // Click to expand
    fireEvent.click(screen.getByText("Prior PRs touching these files"));
    // PR title should now appear
    expect(screen.getByText("Fix")).toBeInTheDocument();
  });

  it("does not render prior PRs accordion when prior_prs is absent", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST,
    } as any);
    renderWithIntl(
      <BlastRadiusSection prId="pr1" onGoToBlast={vi.fn()} />,
    );
    expect(screen.queryByText("Prior PRs touching these files")).not.toBeInTheDocument();
  });

  it("go to Blast tab button calls onGoToBlast", () => {
    const onGoToBlast = vi.fn();
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST,
    } as any);
    renderWithIntl(
      <BlastRadiusSection prId="pr1" onGoToBlast={onGoToBlast} />,
    );
    fireEvent.click(screen.getByText(blastMessages.summary.goToTab));
    expect(onGoToBlast).toHaveBeenCalledTimes(1);
  });
});
