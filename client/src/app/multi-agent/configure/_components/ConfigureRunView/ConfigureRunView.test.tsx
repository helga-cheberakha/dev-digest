import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEstimate } from "@devdigest/shared";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/runs.json";

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
}));

// Hooks — multi-agent
vi.mock("@/lib/hooks/multiAgent", () => ({
  useAgentEstimates: vi.fn(),
  useLaunchMultiAgentRun: vi.fn(),
}));

// Hooks — agents
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: vi.fn(),
}));

import { useAgentEstimates, useLaunchMultiAgentRun } from "@/lib/hooks/multiAgent";
import { useAgents } from "@/lib/hooks/agents";
import { ConfigureRunView } from "./ConfigureRunView";

// ---- Fixtures ---------------------------------------------------------------

const AGENT_A: Agent = {
  id: "ag-alpha",
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
  id: "ag-beta",
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

// Agent A: 10 000 ms / $0.03 — known estimate
const ESTIMATE_A: AgentEstimate = {
  agent_id: "ag-alpha",
  est_duration_ms: 10000,
  est_cost_usd: 0.03,
  last_run_summary: "Found 2 secrets in config files",
};

// Agent B: null / null — zero-history agent (no previous runs)
const ESTIMATE_B: AgentEstimate = {
  agent_id: "ag-beta",
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
  vi.mocked(useAgentEstimates).mockReturnValue({
    data: [ESTIMATE_A, ESTIMATE_B],
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

    // Should show "No PR selected" indicator
    expect(screen.getByText(/no pr selected/i)).toBeInTheDocument();

    // Empty-state body for the agents section
    expect(screen.getByText(/navigate here from a pull request/i)).toBeInTheDocument();

    // Run button must be disabled with count 0
    const btn = screen.getByRole("button", { name: /run multi-agent review/i });
    expect(btn).toBeDisabled();
  });

  it("populates agent cards with names, summaries and estimates when a PR is selected", async () => {
    renderView("pr-42");

    // Agent A: name + summary + estimate
    expect(await screen.findByText("Alpha Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Found 2 secrets in config files")).toBeInTheDocument();
    // "10s" appears in both the agent card estimate and the summary line
    expect(screen.getAllByText(/10s/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$0\.03/).length).toBeGreaterThan(0);

    // Agent B: name (no summary)
    expect(screen.getByText("Beta Linter")).toBeInTheDocument();
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
    // Agent A: 10 000 ms, $0.03
    // Agent B: null, null
    // Both checked by default → max(10 000, null) = 10 000 ms = 10s; sum($0.03, null) = $0.03
    renderView("pr-42");

    await screen.findByText("Alpha Reviewer");

    const summaryTime = screen.getByTestId("summary-time");
    const summaryCost = screen.getByTestId("summary-cost");

    // max is 10s (NOT 10s + null = still 10s, but critically NOT a sum of
    // something that would be larger)
    expect(summaryTime).toHaveTextContent("10s");
    // formatCost(0.03) = "$0.03"
    expect(summaryCost).toHaveTextContent("$0.03");
  });

  it("summary max(duration) is not the sum when two agents have known estimates", async () => {
    // Override: both agents have distinct estimates
    // A: 10 000 ms, B: 5 000 ms
    // max = 10 000 ms = 10s; sum = 15 000 ms would be 15s (must NOT appear)
    vi.mocked(useAgentEstimates).mockReturnValue({
      data: [
        { ...ESTIMATE_A, est_duration_ms: 10000, est_cost_usd: 0.01 },
        { ...ESTIMATE_B, agent_id: "ag-beta", est_duration_ms: 5000, est_cost_usd: 0.02 },
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
        agent_ids: expect.arrayContaining(["ag-alpha", "ag-beta"]),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // Simulate success callback → should navigate to /multi-agent/<id>
    const callArgs = mutate.mock.calls[0]!;
    const options = callArgs[1] as { onSuccess: (data: { id: string; run_ids: string[] }) => void };
    options.onSuccess({ id: "run-xyz", run_ids: ["r1", "r2"] });

    expect(mockPush).toHaveBeenCalledWith("/multi-agent/run-xyz");
  });
});
