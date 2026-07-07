/* IntentCard tests (L05 Why+Risk Brief). Covers AC-13 (Risk Areas accordion:
   icon + title + clickable file_refs; expand -> explanation; 0 risks hides
   the section) and the m2 file_ref parsing branch (range -> start line, bare
   path -> no line) via the risk-accordion's own onOpenFile wiring.
   `fireEvent` only — `userEvent` is not installed
   (client/INSIGHTS.md 2026-07-06). This component has no i18n (hardcoded
   English copy — client/INSIGHTS.md), so no NextIntlClientProvider is needed. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PrIntentRecord, Risk } from "@devdigest/shared";

vi.mock("@/lib/hooks/intent", () => ({
  usePrIntent: vi.fn(),
  useClassifyIntent: vi.fn(),
}));

import { usePrIntent, useClassifyIntent } from "@/lib/hooks/intent";
import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const INTENT: PrIntentRecord = {
  pr_id: "pr1",
  summary: "Add rate limiting to the public API.",
  in_scope: ["ratelimit middleware"],
  out_of_scope: ["auth changes"],
};

const RISKS: Risk[] = [
  {
    kind: "security",
    title: "Possible secret in diff",
    explanation: "Looks like a hard-coded API key in the diff.",
    severity: "high",
    file_refs: ["src/mw/ratelimit.ts:12-20", "src/api/public.ts"],
  },
  {
    kind: "performance",
    title: "N+1 query risk",
    explanation: "The loop issues one query per item.",
    severity: "medium",
    file_refs: [],
  },
];

function mockIntentReady() {
  vi.mocked(usePrIntent).mockReturnValue({
    data: INTENT,
    isLoading: false,
  } as unknown as ReturnType<typeof usePrIntent>);
  vi.mocked(useClassifyIntent).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useClassifyIntent>);
}

describe("IntentCard", () => {
  it("renders the Risk Areas accordion (icon + title), expands to reveal the explanation, and parses file_refs (AC-13, m2)", () => {
    mockIntentReady();
    const onOpenFile = vi.fn();
    render(<IntentCard prId="pr1" risks={RISKS} onOpenFile={onOpenFile} />);

    expect(screen.getByText("RISK AREAS")).toBeInTheDocument();
    expect(screen.getByText("Possible secret in diff")).toBeInTheDocument();
    expect(screen.getByText("N+1 query risk")).toBeInTheDocument();

    // Explanation is collapsed by default.
    expect(
      screen.queryByText("Looks like a hard-coded API key in the diff."),
    ).not.toBeInTheDocument();

    // Expand the first risk (its header is a button with aria-expanded).
    const header = screen.getByRole("button", { name: "Possible secret in diff" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Looks like a hard-coded API key in the diff."),
    ).toBeInTheDocument();

    // m2: a "path:12-20" ref invokes onOpenFile with line = 12 (range start).
    fireEvent.click(screen.getByText("src/mw/ratelimit.ts:12-20"));
    expect(onOpenFile).toHaveBeenCalledWith({ path: "src/mw/ratelimit.ts", line: 12 });

    // m2: a bare path ref invokes onOpenFile with no line.
    fireEvent.click(screen.getByText("src/api/public.ts"));
    expect(onOpenFile).toHaveBeenLastCalledWith({ path: "src/api/public.ts" });
  });

  it("hides the Risk Areas section entirely when there are no risks (0 risks / undefined)", () => {
    mockIntentReady();
    const { rerender } = render(<IntentCard prId="pr1" risks={[]} />);
    expect(screen.queryByText("RISK AREAS")).not.toBeInTheDocument();

    rerender(<IntentCard prId="pr1" />);
    expect(screen.queryByText("RISK AREAS")).not.toBeInTheDocument();
  });
});
