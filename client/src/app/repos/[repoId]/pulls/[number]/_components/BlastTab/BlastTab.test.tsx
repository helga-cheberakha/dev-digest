import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrBlast: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/repo-intel", () => ({
  useRepoIntelStatus: vi.fn(),
}));

import { usePrBlast } from "../../../../../../../lib/hooks/brief";
import { useRepoIntelStatus } from "../../../../../../../lib/hooks/repo-intel";
import { BlastTab } from "./BlastTab";

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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BlastTab (smoke)", () => {
  beforeEach(() => {
    vi.mocked(useRepoIntelStatus).mockReturnValue({
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
      <BlastTab prId="pr1" repoId="repo1" repoFullName="owner/repo" headSha="abc123" />,
    );
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });

  it("renders BlastRadiusView when blast data is present", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST,
    } as any);
    renderWithIntl(
      <BlastTab prId="pr1" repoId="repo1" repoFullName="owner/repo" headSha="abc123" />,
    );
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
  });

  it("renders degraded Badge when intelStatus.degraded = true", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST,
    } as any);
    vi.mocked(useRepoIntelStatus).mockReturnValue({
      data: { degraded: true, degradedReason: undefined, status: "degraded" },
    } as any);
    renderWithIntl(
      <BlastTab prId="pr1" repoId="repo1" repoFullName="owner/repo" headSha="abc123" />,
    );
    expect(
      screen.getByText("Index degraded — results may be incomplete."),
    ).toBeInTheDocument();
  });

  it("caller click calls window.open with a GitHub blob URL containing file path and line", () => {
    vi.mocked(usePrBlast).mockReturnValue({
      isLoading: false,
      isError: false,
      data: BLAST,
    } as any);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithIntl(
      <BlastTab prId="pr1" repoId="repo1" repoFullName="owner/repo" headSha="abc123" />,
    );
    // The MonoLink shows "src/api/public.ts:23" — click it to trigger onWhy
    fireEvent.click(screen.getByText("src/api/public.ts:23"));
    expect(openSpy).toHaveBeenCalledOnce();
    const url = openSpy.mock.calls[0]![0] as string;
    expect(url).toContain("src/api/public.ts");
    expect(url).toContain("#L23");
    expect(openSpy).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });
});
