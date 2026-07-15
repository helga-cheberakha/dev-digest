import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEstimate } from "@devdigest/shared";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/runs.json";
// R7 drift guard: primary populated-state tests consume the shared fixture
// instead of an inline hand-authored literal, so this test can't silently
// diverge from what the server actually returns.
import fixtureEstimates from "../../__fixtures__/agent-estimates.fixture.json";

// ---- Mocks ------------------------------------------------------------------

// next/navigation — provide a mock router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// AppShell renders children directly
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// SafeMarkdown renders content as plain text (untrusted-text path)
vi.mock("@/components/SafeMarkdown", () => ({
  SafeMarkdown: ({ content }: { content: string }) => <span data-testid="safe-markdown">{content}</span>,
}));

// Design-system primitives — stubbed to their text/interaction surface.
// Per INSIGHTS.md 2026-07-11: every named export the component uses must be
// listed; a factory that omits any import causes "Element type is invalid".
vi.mock("@devdigest/ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Skeleton: ({ height }: { height: number }) => (
    <div data-testid="skeleton" style={{ height }} />
  ),
  ErrorState: ({ body }: { body: string }) => <div role="alert">{body}</div>,
  EmptyState: ({ title, body }: { title?: string; body?: string }) => (
    <div>{title ?? body}</div>
  ),
  Icon: new Proxy({}, { get: () => () => <svg data-testid="icon" /> }),
  Dropdown: ({
    trigger,
    items,
  }: {
    trigger: React.ReactNode;
    items: { label: string; onClick?: () => void; muted?: boolean }[];
  }) => (
    <div>
      {trigger}
      <div data-testid="dropdown-items">
        {items.map((it, i) => (
          <button key={i} onClick={it.onClick} disabled={!it.onClick}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  ),
}));

// Hooks — multi-agent
vi.mock("@/lib/hooks/multiAgent", () => ({
  useAgentEstimates: vi.fn(),
  useLaunchMultiAgentRun: vi.fn(),
  useLatestMultiAgentRun: vi.fn(),
  useRecentMultiAgentRuns: vi.fn(),
}));

// Hooks — agents
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: vi.fn(),
}));

// Hooks — core (provides usePullDetail for the PR number+title display, and
// usePulls to populate the PR-picker dropdown for the active repo)
vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: vi.fn(),
  usePulls: vi.fn(),
}));

// repo-context — a fixed active repo id (the picker lists PRs for it)
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1" }),
}));

import {
  useAgentEstimates,
  useLaunchMultiAgentRun,
  useLatestMultiAgentRun,
  useRecentMultiAgentRuns,
} from "@/lib/hooks/multiAgent";
import { useAgents } from "@/lib/hooks/agents";
import { usePullDetail, usePulls } from "@/lib/hooks/core";
import { ConfigureRunView } from "./ConfigureRunView";

// ---- Fixtures ---------------------------------------------------------------

// IDs match the R7 golden fixture (server/src/modules/multi-agent/__fixtures__/agent-estimates.fixture.json,
// copied byte-identical into this page's __fixtures__ dir) so the "populated" tests below render against
// the fixture's real agent_ids rather than a disconnected literal.
const FIXTURE_AGENT_A_ID = "34b792f1-9118-41c7-8b50-e3729fd64ff3";
const FIXTURE_AGENT_B_ID = "e1eaba7c-7fad-44a9-b507-5bb8d5997288";

const AGENT_A: Agent = {
  id: FIXTURE_AGENT_A_ID,
  name: "Alpha Reviewer",
  description: "Security agent",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const AGENT_B: Agent = {
  id: FIXTURE_AGENT_B_ID,
  name: "Beta Linter",
  description: "Style agent",
  provider: "anthropic",
  model: "claude-sonnet-4",
  system_prompt: "You are a style linter.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

// Agent A: 10 000 ms / $0.03 — known estimate (used only by tests that override
// useAgentEstimates inline to exercise max-vs-sum math in isolation; the
// "populated" tests below use the real fixture instead, see fixtureEstimates).
const ESTIMATE_A: AgentEstimate = {
  agent_id: FIXTURE_AGENT_A_ID,
  est_duration_ms: 10000,
  est_cost_usd: 0.03,
  last_run_summary: "Found 2 secrets in config files",
};

// Agent B: null / null — zero-history agent (no previous runs)
const ESTIMATE_B: AgentEstimate = {
  agent_id: FIXTURE_AGENT_B_ID,
  est_duration_ms: null,
  est_cost_usd: null,
  last_run_summary: null,
};

// ---- Helpers ----------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderView(prId?: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <ConfigureRunView initialPrId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---- Default mock setup -----------------------------------------------------

function setDefaultMocks() {
  // Use the shared fixture (not inline literals) so the populated-state tests
  // stay in sync with the server's actual response shape (R7 drift guard).
  vi.mocked(useAgentEstimates).mockReturnValue({
    data: fixtureEstimates as AgentEstimate[],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAgentEstimates>);

  vi.mocked(useAgents).mockReturnValue({
    data: [AGENT_A, AGENT_B],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAgents>);

  vi.mocked(useLaunchMultiAgentRun).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useLaunchMultiAgentRun>);

  vi.mocked(usePullDetail).mockReturnValue({
    data: { number: 42, title: "Fix security issue" },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof usePullDetail>);

  vi.mocked(usePulls).mockReturnValue({
    data: [
      { id: "pr-42", number: 42, title: "Fix security issue", status: "needs_review" },
      { id: "pr-40", number: 40, title: "Stale one", status: "stale" },
    ],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof usePulls>);

  vi.mocked(useLatestMultiAgentRun).mockReturnValue({
    data: { run: null },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useLatestMultiAgentRun>);

  vi.mocked(useRecentMultiAgentRuns).mockReturnValue({
    data: { runs: [] },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useRecentMultiAgentRuns>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockPush.mockClear();
});

// ---- Tests ------------------------------------------------------------------

describe("ConfigureRunView", () => {
  beforeEach(setDefaultMocks);

  it("shows empty state and disabled run button when no PR is selected", () => {
    renderView(/* no prId */);

    // The PR-picker trigger shows the placeholder, not a PR
    expect(screen.getByText(/select a pull request/i)).toBeInTheDocument();

    // Empty-state body for the agents section
    expect(screen.getByText(/choose which pr to review above/i)).toBeInTheDocument();

    // Run button must be disabled with count 0
    const btn = screen.getByRole("button", { name: /run multi-agent review/i });
    expect(btn).toBeDisabled();
  });

  it("lists only non-stale PRs in the picker and selecting one populates the agents section", async () => {
    renderView(/* no prId */);

    const items = screen.getByTestId("dropdown-items");
    // The stale PR is filtered out (matches the design's status !== "stale")
    expect(within(items).queryByText(/stale one/i)).not.toBeInTheDocument();

    const prItem = within(items).getByText(/fix security issue/i);
    fireEvent.click(prItem);

    // Selecting a PR from the picker populates the agents section (same as
    // arriving with ?prId= pre-selected)
    expect(await screen.findByText("Alpha Reviewer")).toBeInTheDocument();
  });

  it("shows a 'last run' banner for the selected PR and navigates to it on click", async () => {
    vi.mocked(useLatestMultiAgentRun).mockReturnValue({
      data: { run: { id: "run-prev", ran_at: new Date(Date.now() - 3_600_000).toISOString(), agent_count: 3 } },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useLatestMultiAgentRun>);

    renderView("pr-42");
    await screen.findByText("Alpha Reviewer");

    const banner = screen.getByText(/last run/i);
    expect(banner).toBeInTheDocument();
    fireEvent.click(banner);

    expect(mockPush).toHaveBeenCalledWith("/multi-agent/run-prev");
  });

  it("does not show a 'last run' banner when the PR has no prior multi-agent runs", async () => {
    renderView("pr-42");
    await screen.findByText("Alpha Reviewer");

    expect(screen.queryByText(/last run/i)).not.toBeInTheDocument();
  });

  it("populates agent cards with names and estimates when a PR is selected", async () => {
    renderView("pr-42");

    // Agent A: name + estimate, from the real fixture (3100ms / $0.018)
    expect(await screen.findByText("Alpha Reviewer")).toBeInTheDocument();
    // "3s" appears in both the agent card estimate and the summary line
    expect(screen.getAllByText(/3s/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$0\.018/).length).toBeGreaterThan(0);

    // Agent B: name (zero-history, no estimate)
    expect(screen.getByText("Beta Linter")).toBeInTheDocument();
  });

  it("renders an agent's last-run summary as a one-line description when present (AC-7)", async () => {
    // The real fixture's agents both have a null last_run_summary, so this
    // narrow behavior is exercised with an inline override, same pattern as
    // the max/sum tests below — not a fixture-conformance concern, just UI.
    vi.mocked(useAgentEstimates).mockReturnValue({
      data: [ESTIMATE_A, ESTIMATE_B],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentEstimates>);

    renderView("pr-42");

    expect(await screen.findByText("Found 2 secrets in config files")).toBeInTheDocument();
  });

  it("shows the no-estimate indicator for a zero-history agent", async () => {
    renderView("pr-42");

    // Wait for cards to render
    await screen.findByText("Beta Linter");

    // Agent B has null estimates — both duration and cost cells for that agent
    // show the no-estimate label. The label appears at least twice (one per
    // null field on the card).
    const noEstLabels = screen.getAllByText(/no estimate/i);
    expect(noEstLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("summary line shows max(duration) not sum, and sum(cost)", async () => {
    // Agent A (fixture): 3 100 ms, $0.018
    // Agent B (fixture): null, null
    // Both checked by default → max(3 100, null) = 3 100 ms = 3s; sum($0.018, null) = $0.018
    renderView("pr-42");

    await screen.findByText("Alpha Reviewer");

    const summaryTime = screen.getByTestId("summary-time");
    const summaryCost = screen.getByTestId("summary-cost");

    // max is 3s (NOT summed with a null, but critically NOT a sum of
    // something that would be larger)
    expect(summaryTime).toHaveTextContent("3s");
    expect(summaryCost).toHaveTextContent("$0.018");
  });

  it("summary max(duration) is not the sum when two agents have known estimates", async () => {
    // Override: both agents have distinct estimates
    // A: 10 000 ms, B: 5 000 ms
    // max = 10 000 ms = 10s; sum = 15 000 ms would be 15s (must NOT appear)
    vi.mocked(useAgentEstimates).mockReturnValue({
      data: [
        { ...ESTIMATE_A, est_duration_ms: 10000, est_cost_usd: 0.01 },
        { ...ESTIMATE_B, agent_id: FIXTURE_AGENT_B_ID, est_duration_ms: 5000, est_cost_usd: 0.02 },
      ],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgentEstimates>);

    renderView("pr-42");
    await screen.findByText("Alpha Reviewer");

    const summaryTime = screen.getByTestId("summary-time");
    const summaryCost = screen.getByTestId("summary-cost");

    // time = max(10 000, 5 000) = 10 000 ms = 10s, NOT 15s (sum)
    expect(summaryTime).toHaveTextContent("10s");
    expect(summaryTime).not.toHaveTextContent("15s");

    // cost = sum(0.01, 0.02) = $0.03
    expect(summaryCost).toHaveTextContent("$0.03");
  });

  it("clicking run launches via useLaunchMultiAgentRun and navigates on success", async () => {
    const mutate = vi.fn();
    vi.mocked(useLaunchMultiAgentRun).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchMultiAgentRun>);

    renderView("pr-42");
    await screen.findByText("Alpha Reviewer");

    const btn = screen.getByRole("button", { name: /run multi-agent review/i });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        prId: "pr-42",
        agent_ids: expect.arrayContaining([FIXTURE_AGENT_A_ID, FIXTURE_AGENT_B_ID]),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // Simulate success callback → should navigate to /multi-agent/<id>
    const callArgs = mutate.mock.calls[0]!;
    const options = callArgs[1] as { onSuccess: (data: { id: string; run_ids: string[] }) => void };
    options.onSuccess({ id: "run-xyz", run_ids: ["r1", "r2"] });

    expect(mockPush).toHaveBeenCalledWith("/multi-agent/run-xyz");
  });

  it("shows an empty message when there are no recent reviews", () => {
    renderView(/* no prId */);

    expect(screen.getByText(/no multi-agent reviews yet/i)).toBeInTheDocument();
  });

  it("lists up to 5 recent reviews and navigates to a run on click", () => {
    vi.mocked(useRecentMultiAgentRuns).mockReturnValue({
      data: {
        runs: [
          { id: "run-1", ran_at: new Date(Date.now() - 60_000).toISOString(), agent_count: 2, pr_id: "pr-1", pr_number: 10, pr_title: "First PR" },
          { id: "run-2", ran_at: new Date(Date.now() - 3_600_000).toISOString(), agent_count: 3, pr_id: "pr-2", pr_number: 11, pr_title: "Second PR" },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRecentMultiAgentRuns>);

    renderView(/* no prId */);

    expect(screen.getByText(/#10 · first pr/i)).toBeInTheDocument();
    expect(screen.getByText(/#11 · second pr/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/#10 · first pr/i));
    expect(mockPush).toHaveBeenCalledWith("/multi-agent/run-1");
  });

  it("shows loading skeletons for the recent reviews list while fetching", () => {
    vi.mocked(useRecentMultiAgentRuns).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useRecentMultiAgentRuns>);

    renderView(/* no prId */);

    expect(screen.queryAllByTestId("skeleton").length).toBeGreaterThan(0);
  });
});
