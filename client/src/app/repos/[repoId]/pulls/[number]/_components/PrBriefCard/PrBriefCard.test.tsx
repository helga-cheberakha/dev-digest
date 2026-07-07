/* PrBriefCard tests (L05 Why+Risk Brief rework). Rebuilt from the old
   composed-`PrBrief` fixtures (deleted contract) to the new `Brief` shape.
   Covers AC-10 (banner colour-by-risk_level + what/why), AC-11 (all five
   review metrics), AC-12 (no-review nudge + Run Review button), AC-15
   (Regenerate posts force=true + disables in flight), and the m2 file_ref
   parsing branch (range -> start line, bare path -> no line). `fireEvent`
   only — `userEvent` is not installed (client/INSIGHTS.md 2026-07-06). */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Brief, ReviewRecord } from "@devdigest/shared";
import prBriefMessages from "../../../../../../../../messages/en/prBrief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

// ---- Mocks -----------------------------------------------------------------

// `usePrBrief` is stubbed per-test; `useRegenerateBrief` stays REAL so AC-15's
// "posts force=true" assertion exercises the actual mutationFn body, not a
// re-statement of it — only the underlying `api.post` is intercepted below.
vi.mock("../../../../../../../lib/hooks/brief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/hooks/brief")>();
  return { ...actual, usePrBrief: vi.fn() };
});

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(),
}));

vi.mock("../../../../../../../lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn() },
}));

// RunReviewDropdown has its own test coverage — stub it here so the AC-12
// nudge assertion only checks "a Run Review action is present", not its
// internals (which need useAgents/useRunReview/useRouter of their own).
vi.mock("../RunReviewDropdown", () => ({
  RunReviewDropdown: ({ prId }: { prId: string }) => (
    <button type="button">Run Review ({prId})</button>
  ),
}));

import { usePrBrief } from "../../../../../../../lib/hooks/brief";
import { usePrReviews } from "../../../../../../../lib/hooks/reviews";
import { api } from "../../../../../../../lib/api";
import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PR_ID = "pr1";

const BRIEF: Brief = {
  what: "Adds rate limiting to the public API.",
  why: "Prevents abuse of the /public/data endpoint under load.",
  risk_level: "high",
  risks: [
    {
      kind: "security",
      title: "Possible secret in diff",
      explanation: "Looks like a hard-coded API key in the diff.",
      severity: "high",
      file_refs: ["src/mw/ratelimit.ts"],
    },
  ],
  review_focus: [
    {
      label: "Check the rate limiter's window boundary logic.",
      file_refs: ["src/mw/ratelimit.ts:12-20", "src/api/public.ts"],
    },
  ],
};

const REVIEW: ReviewRecord = {
  id: "rev1",
  pr_id: PR_ID,
  agent_id: "agent1",
  run_id: "run1",
  agent_name: "Security Agent",
  kind: "review",
  verdict: "request_changes",
  summary: "Found one blocker.",
  score: 82,
  model: "gpt-4.1",
  grounding: null,
  created_at: "2026-01-01T00:00:00.000Z",
  findings: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "security",
      title: "Blocker finding",
      file: "src/mw/ratelimit.ts",
      start_line: 1,
      end_line: 2,
      rationale: "r",
      confidence: 0.9,
      review_id: "rev1",
      accepted_at: null,
      dismissed_at: null,
    },
    {
      id: "f2",
      severity: "CRITICAL",
      category: "bug",
      title: "Dismissed finding (not a blocker)",
      file: "src/mw/ratelimit.ts",
      start_line: 5,
      end_line: 6,
      rationale: "r",
      confidence: 0.8,
      review_id: "rev1",
      accepted_at: null,
      dismissed_at: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "f3",
      severity: "WARNING",
      category: "style",
      title: "Warning finding",
      file: "src/mw/ratelimit.ts",
      start_line: 9,
      end_line: 9,
      rationale: "r",
      confidence: 0.5,
      review_id: "rev1",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
  tokens_in: 1500,
  tokens_out: 320,
  cost_usd: 0.1234,
};

function renderCard(onOpenFile?: (ref: { path: string; line?: number }) => void) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prBrief: prBriefMessages, prReview: prReviewMessages }}>
        <PrBriefCard prId={PR_ID} onOpenFile={onOpenFile} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PrBriefCard", () => {
  beforeEach(() => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: BRIEF,
      isLoading: false,
      isError: false,
      error: undefined,
    } as unknown as ReturnType<typeof usePrBrief>);
  });

  it("renders the risk banner + what/why and all five review metrics, and parses review_focus file_refs (AC-10, AC-11, m2)", () => {
    vi.mocked(usePrReviews).mockReturnValue({
      data: [REVIEW],
    } as unknown as ReturnType<typeof usePrReviews>);
    const onOpenFile = vi.fn();
    renderCard(onOpenFile);

    // AC-10: banner colour-by-risk_level (asserted via the translated label,
    // not CSS) + what/why text.
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.why)).toBeInTheDocument();

    // AC-11: findings_count, blockers, score, cost_usd, tokens_in->tokens_out.
    expect(screen.getByText("Findings")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // findings.length
    expect(screen.getByText("Blockers")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // 1 CRITICAL, not dismissed
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("$0.12")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("1,500 → 320")).toBeInTheDocument();

    // No-review nudge must NOT render alongside a completed review.
    expect(screen.queryByText("Review not run yet")).not.toBeInTheDocument();

    // m2: a "path:12-20" ref invokes onOpenFile with line = 12 (range start).
    fireEvent.click(screen.getByText("src/mw/ratelimit.ts:12-20"));
    expect(onOpenFile).toHaveBeenCalledWith({ path: "src/mw/ratelimit.ts", line: 12 });

    // m2: a bare path ref invokes onOpenFile with no line.
    fireEvent.click(screen.getByText("src/api/public.ts"));
    expect(onOpenFile).toHaveBeenLastCalledWith({ path: "src/api/public.ts" });
  });

  it("shows the AC-12 nudge with a Run Review action when no completed review exists", () => {
    vi.mocked(usePrReviews).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof usePrReviews>);
    renderCard();

    expect(screen.getByText("Review not run yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Run Review (${PR_ID})` })).toBeInTheDocument();

    // Metrics row must not render in place of the nudge.
    expect(screen.queryByText("Findings")).not.toBeInTheDocument();
  });

  it("Regenerate posts force=true and disables the button while in flight (AC-15)", async () => {
    vi.mocked(usePrReviews).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof usePrReviews>);
    let resolvePost: (value: Brief) => void = () => {};
    const postMock = vi.fn(
      () =>
        new Promise<Brief>((resolve) => {
          resolvePost = resolve;
        }),
    );
    vi.mocked(api.post).mockImplementation(postMock as unknown as typeof api.post);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(`/pulls/${PR_ID}/brief`, { force: true }),
    );
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();

    resolvePost(BRIEF);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regenerate" })).not.toBeDisabled(),
    );
  });

  it("ErrorState retry calls the query's refetch (force=false), never a force=true regenerate", () => {
    const refetch = vi.fn();
    vi.mocked(usePrBrief).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("network blip"),
      refetch,
    } as unknown as ReturnType<typeof usePrBrief>);
    vi.mocked(usePrReviews).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof usePrReviews>);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    // Idempotent refetch (no force:true POST), never the paid regenerate call.
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });
});
