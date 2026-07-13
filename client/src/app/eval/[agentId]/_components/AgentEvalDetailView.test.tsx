import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalRunBatch, EvalCompare } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

// ---- Mocks ----------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: vi.fn(),
  useAgent: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  fetchEvalDashboard: vi.fn(),
  fetchEvalBatches: vi.fn(),
  fetchEvalCompare: vi.fn(),
  runEvalBatch: vi.fn(),
  promoteVersion: vi.fn(),
  evalQueryKeys: {
    cases: (agentId: string) => ["eval-cases", agentId],
    batches: (agentId: string) => ["eval-batches", agentId],
    compare: (agentId: string, a: string, b: string) => ["eval-compare", agentId, a, b],
    dashboard: (agentId?: string) => ["eval-dashboard", agentId],
  },
  ApiError: class ApiError extends Error {},
}));

import { useAgents, useAgent } from "@/lib/hooks/agents";
import {
  fetchEvalDashboard,
  fetchEvalBatches,
  fetchEvalCompare,
  runEvalBatch,
  promoteVersion,
} from "@/lib/api";
import { AgentEvalDetailView } from "./AgentEvalDetailView";

// ---- Fixtures ---------------------------------------------------------------

const AGENT: Partial<Agent> = { id: "ag1", name: "Security Reviewer", model: "gpt-4.1" };
const OTHER_AGENT: Partial<Agent> = { id: "ag2", name: "Performance Reviewer", model: "gpt-4o" };

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 20,
  current: {
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    cost_usd: 0.23,
  },
  delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
  trend: [
    { ran_at: "2026-05-27T16:40:00Z", recall: 0.78, precision: 0.93, citation_accuracy: 0.94, pass_rate: 0.8, cost_usd: 0.21, agent_version: 6 },
    { ran_at: "2026-05-29T09:14:00Z", recall: 0.82, precision: 0.91, citation_accuracy: 0.95, pass_rate: 0.85, cost_usd: 0.23, agent_version: 7 },
  ],
  recent_runs: [],
  alert: "Precision dipped 2pts on v7 — a new false positive slipped in. Recall and citation both up.",
};

const BATCHES: EvalRunBatch[] = [
  {
    batch_id: "batch-v7",
    ran_at: "2026-05-29T09:14:00Z",
    agent_version: 7,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    cost_usd: 0.23,
  },
  {
    batch_id: "batch-v6",
    ran_at: "2026-05-27T16:40:00Z",
    agent_version: 6,
    recall: 0.78,
    precision: 0.93,
    citation_accuracy: 0.94,
    traces_passed: 16,
    traces_total: 20,
    cost_usd: 0.21,
  },
];

const COMPARE: EvalCompare = {
  a: BATCHES[1]!,
  b: BATCHES[0]!,
  prompt_diff: {
    old: "You are a reviewer.\nReturn at most 5 findings.",
    new: "You are a reviewer.\nFlag unused imports.\nReturn at most 5 findings.",
  },
  delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01, cost_usd: 0.02 },
};

// ---- Helpers ----------------------------------------------------------------

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function setDefaultMocks() {
  vi.mocked(useAgent).mockReturnValue({
    data: AGENT,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useAgent>);

  vi.mocked(useAgents).mockReturnValue({
    data: [AGENT, OTHER_AGENT],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAgents>);

  vi.mocked(fetchEvalDashboard).mockResolvedValue(DASHBOARD);
  vi.mocked(fetchEvalBatches).mockResolvedValue(BATCHES);
  vi.mocked(fetchEvalCompare).mockResolvedValue(COMPARE);
  vi.mocked(runEvalBatch).mockResolvedValue({
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    duration_ms: 1000,
    cost_usd: 0.23,
    per_trace: [],
  });
  vi.mocked(promoteVersion).mockResolvedValue(AGENT as Agent);
}

afterEach(cleanup);

// ---- Tests ------------------------------------------------------------------

describe("AgentEvalDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("renders agent header, subtitle, and colored metric cards", async () => {
    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    // Agent name also appears in the agent-switcher dropdown trigger — scope to the H1.
    expect(await screen.findByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    // subtitle depends on the dashboard/batches queries resolving (async) —
    // wait rather than assert synchronously, or it still reads the 0/0 initial state.
    expect(await screen.findByText(/2 runs on the 20-trace gold set/i)).toBeInTheDocument();

    // MetricCard values (recall 82%, precision 91%, citation 95%)
    expect(await screen.findByText("82")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("renders the regression alert banner", async () => {
    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);
    expect(
      await screen.findByText(/precision dipped 2pts on v7/i),
    ).toBeInTheDocument();
  });

  it("renders one recent-runs row per batch with version, pass fraction, and cost", async () => {
    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("v7")).toBeInTheDocument();
    expect(within(table).getByText("v6")).toBeInTheDocument();
    expect(within(table).getByText("17/20")).toBeInTheDocument();
    expect(within(table).getByText("$0.23")).toBeInTheDocument();
  });

  it("enables Compare only after exactly 2 runs are selected, and opens the modal with the right old→new order", async () => {
    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    const table = await screen.findByRole("table");
    const checkboxes = within(table).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);

    const compareBtn = screen.getByRole("button", { name: /^compare$/i });
    expect(compareBtn).toBeDisabled();

    fireEvent.click(checkboxes[0]!); // v7 (newer)
    expect(compareBtn).toBeDisabled();

    fireEvent.click(checkboxes[1]!); // v6 (older)
    expect(compareBtn).not.toBeDisabled();

    fireEvent.click(compareBtn);

    // Modal title: "Compare runs · v6 → v7" (old first regardless of click order)
    expect(await screen.findByText(/compare runs.*v6.*v7/i)).toBeInTheDocument();

    // Prompt diff: the added line renders, unchanged lines still present
    expect(await screen.findByText("Flag unused imports.")).toBeInTheDocument();
    expect(screen.getAllByText(/You are a reviewer\./).length).toBeGreaterThan(0);
  });

  it("promoting from the compare modal calls promoteVersion with the newer version", async () => {
    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    const table = await screen.findByRole("table");
    const checkboxes = within(table).getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));

    const promoteBtn = await screen.findByRole("button", { name: /promote v7/i });
    fireEvent.click(promoteBtn);

    await waitFor(() => {
      expect(vi.mocked(promoteVersion)).toHaveBeenCalledWith("ag1", 7);
    });
  });

  it("clicking Run eval calls runEvalBatch for this agent", async () => {
    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    await screen.findByRole("heading", { name: "Security Reviewer" });
    fireEvent.click(screen.getByRole("button", { name: /run eval/i }));

    await waitFor(() => {
      expect(vi.mocked(runEvalBatch)).toHaveBeenCalledWith("ag1");
    });
  });

  it("renders a single-run agent's metric cards without a sparkline (regression: 1-point trend must not divide by zero)", async () => {
    const oneBatch = [BATCHES[0]!];
    vi.mocked(fetchEvalBatches).mockResolvedValue(oneBatch);
    vi.mocked(fetchEvalDashboard).mockResolvedValue({
      ...DASHBOARD,
      trend: [DASHBOARD.trend[1]!],
    });

    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    // Metric values still render from `current`, no crash from a 1-point trend.
    expect(await screen.findByText("82")).toBeInTheDocument();
    // A single-point trend must not render a sparkline path (division-by-zero → NaN).
    expect(document.querySelector("path[d*='NaN']")).not.toBeInTheDocument();
  });

  it("renders the trend chart's tooltip metadata without crashing when a point's agent_version is null", async () => {
    vi.mocked(fetchEvalDashboard).mockResolvedValue({
      ...DASHBOARD,
      trend: [
        { ...DASHBOARD.trend[0]!, agent_version: null },
        DASHBOARD.trend[1]!,
      ],
    });

    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    // Chart still renders (2 points) — no crash from a null agent_version on one point.
    expect(await screen.findByText("82")).toBeInTheDocument();
    expect(screen.getByText(/metric trend/i)).toBeInTheDocument();
  });

  it("shows an empty state when the agent has no batch history", async () => {
    vi.mocked(fetchEvalBatches).mockResolvedValue([]);
    vi.mocked(fetchEvalDashboard).mockResolvedValue({
      ...DASHBOARD,
      trend: [],
      alert: null,
    });

    renderWithProviders(<AgentEvalDetailView agentId="ag1" />);

    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
