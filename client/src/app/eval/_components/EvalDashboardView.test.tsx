import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";

// ---- Mocks ----------------------------------------------------------------

// next/link renders an <a> in the test environment
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <a href={href} style={style}>
      {children}
    </a>
  ),
}));

// AppShell renders children directly (shell depends on global context not needed here)
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Skeleton renders a placeholder div
vi.mock("@devdigest/ui", () => ({
  Skeleton: ({ height }: { height: number }) => (
    <div data-testid="skeleton" style={{ height }} />
  ),
}));

// Agents hook
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: vi.fn(),
}));

// API functions
vi.mock("@/lib/api", () => ({
  fetchEvalDashboard: vi.fn(),
  runEvalBatch: vi.fn(),
}));

import { useAgents } from "@/lib/hooks/agents";
import { fetchEvalDashboard, runEvalBatch } from "@/lib/api";
import { EvalDashboardView } from "./EvalDashboardView";

// ---- Fixtures ---------------------------------------------------------------

const AGENTS = [
  { id: "ag1", name: "Security Reviewer", enabled: true },
  { id: "ag2", name: "Style Checker", enabled: true },
];

/** ag1 has 2 batches — real non-zero metrics + delta + sparkline */
const AGENT1_DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 10,
  current: {
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.75,
    traces_passed: 8,
    traces_total: 10,
    cost_usd: null,
  },
  delta: { recall: 0.05, precision: -0.02, citation_accuracy: 0.01 },
  trend: [
    {
      ran_at: "2026-07-01T00:00:00Z",
      recall: 0.77,
      precision: 0.93,
      citation_accuracy: 0.74,
      pass_rate: 0.8,
      cost_usd: null,
    },
    {
      ran_at: "2026-07-08T00:00:00Z",
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.75,
      pass_rate: 0.8,
      cost_usd: null,
    },
  ],
  recent_runs: [],
  alert: null,
};

/** ag2 has no batches yet */
const AGENT2_DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag2",
  cases_total: 0,
  current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [],
  alert: null,
};

/** Workspace-level: recent_runs empty (documents current server behaviour) */
const WORKSPACE_DASHBOARD: EvalDashboard = {
  owner_kind: null,
  owner_id: null,
  cases_total: 0,
  current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [],
  alert: null,
};

// ---- Helpers ----------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---- Default mock setup -------------------------------------------------------

function setDefaultMocks() {
  vi.mocked(useAgents).mockReturnValue({
    data: AGENTS,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAgents>);

  vi.mocked(fetchEvalDashboard).mockImplementation(async (agentId?: string): Promise<EvalDashboard> => {
    if (!agentId) return WORKSPACE_DASHBOARD;
    if (agentId === "ag1") return AGENT1_DASHBOARD;
    return AGENT2_DASHBOARD;
  });

  vi.mocked(runEvalBatch).mockResolvedValue({
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.7,
    traces_passed: 8,
    traces_total: 10,
    duration_ms: 1200,
    cost_usd: null,
    per_trace: [],
  });
}

afterEach(cleanup);

// ---- Tests ------------------------------------------------------------------

describe("EvalDashboardView", () => {
  beforeEach(setDefaultMocks);

  it("renders one card per agent with real non-zero metrics after data loads", async () => {
    renderWithProviders(<EvalDashboardView />);

    // Both agent names appear (cards for ag1 and ag2)
    expect(await screen.findByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Style Checker")).toBeInTheDocument();

    // Real metrics for ag1 (recall=82%, precision=91%, citation=75%)
    expect(await screen.findByText("82%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();

    // ag2 has no batches — shows "No runs yet." placeholder
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("shows empty state for workspace recent_runs table when recent_runs is []", async () => {
    renderWithProviders(<EvalDashboardView />);

    // Wait for agents to render
    await screen.findByText("Security Reviewer");

    // The empty state message for the workspace-level table
    expect(
      screen.getByText("No recent eval runs across all agents."),
    ).toBeInTheDocument();

    // No table rows
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows loading skeletons while agents are fetching", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useAgents>);

    renderWithProviders(<EvalDashboardView />);

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows no-agents message when agent list is empty", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: [] as (typeof AGENTS)[number][],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAgents>);

    renderWithProviders(<EvalDashboardView />);

    expect(screen.getByText("No agents configured.")).toBeInTheDocument();
  });

  it("renders alert banner when an agent has an alert", async () => {
    vi.mocked(fetchEvalDashboard).mockImplementation(async (agentId?: string): Promise<EvalDashboard> => {
      if (!agentId) return WORKSPACE_DASHBOARD;
      if (agentId === "ag1") {
        return {
          ...AGENT1_DASHBOARD,
          alert: "Regression: case 'stripe-key-leak' no longer finds the expected issue.",
        };
      }
      return AGENT2_DASHBOARD;
    });

    renderWithProviders(<EvalDashboardView />);

    expect(
      await screen.findByText(
        "Regression: case 'stripe-key-leak' no longer finds the expected issue.",
      ),
    ).toBeInTheDocument();
    // rendered as role="alert"
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders workspace recent_runs table rows when data is populated", async () => {
    const runRow = {
      id: "run-1",
      case_id: "case-1",
      case_name: "stripe-key-leak",
      ran_at: "2026-07-10T12:00:00Z",
      actual_output: null,
      pass: true,
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.8,
      duration_ms: null,
      cost_usd: null,
      batch_id: "batch-1",
      agent_version: 1,
    };

    vi.mocked(fetchEvalDashboard).mockImplementation(async (agentId?: string): Promise<EvalDashboard> => {
      if (!agentId) return { ...WORKSPACE_DASHBOARD, recent_runs: [runRow] };
      if (agentId === "ag1") return AGENT1_DASHBOARD;
      return AGENT2_DASHBOARD;
    });

    renderWithProviders(<EvalDashboardView />);

    // Wait for the table to appear (workspace dashboard resolves asynchronously)
    const table = await screen.findByRole("table");
    expect(table).toBeInTheDocument();

    // Empty-state message should be gone once real data is in
    expect(screen.queryByText("No recent eval runs across all agents.")).not.toBeInTheDocument();

    // Row values: recall 0.9 = 90%
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("pass")).toBeInTheDocument();
  });
});
