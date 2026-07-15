import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import messages from "../../../../messages/en/ci.json";

// ---- Mocks -----------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@devdigest/ui", () => ({
  Skeleton: ({ height }: { height: number }) => (
    <div data-testid="skeleton" style={{ height }} />
  ),
  Button: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {loading ? "…" : children}
    </button>
  ),
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  EmptyState: ({
    title,
    body,
    cta,
    onCta,
  }: {
    title: string;
    body?: React.ReactNode;
    cta?: string;
    onCta?: () => void;
  }) => (
    <div>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {cta && <button onClick={onCta}>{cta}</button>}
    </div>
  ),
  Icon: new Proxy(
    {},
    { get: () => () => <svg data-testid="icon" /> },
  ),
}));

vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: vi.fn(),
  useRefreshCiRuns: vi.fn(),
  useCiInstallations: vi.fn(),
  useExportCi: vi.fn(),
}));

import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { CiRunsView } from "./CiRunsView";

// ---- Fixtures ---------------------------------------------------------------

const TODAY = new Date().toISOString();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

const CI_RUNS: CiRun[] = [
  {
    id: "run-1",
    ci_installation_id: "install-1",
    pr_number: 42,
    ran_at: TODAY,
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.015,
    github_url: "https://github.com/acme/repo/actions/runs/1",
    source: "gha",
    agent: "Security Reviewer",
    duration_s: 45,
    github_run_id: "12345",
  },
  {
    id: "run-2",
    ci_installation_id: "install-1",
    pr_number: 41,
    ran_at: YESTERDAY,
    status: "no_findings",
    findings_count: 0,
    cost_usd: 0.012,
    github_url: "https://github.com/acme/repo/actions/runs/2",
    source: "gha",
    agent: "Security Reviewer",
    duration_s: 30,
    github_run_id: "12344",
  },
  {
    id: "run-3",
    ci_installation_id: null,
    pr_number: null,
    ran_at: TODAY,
    status: "failed",
    findings_count: null,
    cost_usd: null,
    github_url: null,
    source: "circle",
    agent: "Style Checker",
    duration_s: null,
    github_run_id: null,
  },
];

// ---- Helpers ----------------------------------------------------------------

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const refreshMutate = vi.fn();

function setDefaultMocks() {
  vi.mocked(useCiRuns).mockReturnValue({
    data: CI_RUNS,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useCiRuns>);

  vi.mocked(useRefreshCiRuns).mockReturnValue({
    mutate: refreshMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useRefreshCiRuns>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---- Tests ------------------------------------------------------------------

describe("CiRunsView", () => {
  beforeEach(setDefaultMocks);

  it("loads and renders rows from GET /ci-runs", () => {
    // Default time filter is "Last 7 days" — run-2 (YESTERDAY) and run-1/run-3
    // (TODAY) are all within 7 days, so all three rows appear in the table.
    renderWithProviders(<CiRunsView />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CI Runs");

    const table = screen.getByRole("table");

    // PR numbers visible in table rows
    expect(within(table).getByText("#42")).toBeInTheDocument();
    expect(within(table).getByText("#41")).toBeInTheDocument();

    // Agent names in table (distinct from the filter option elements)
    expect(within(table).getAllByText("Security Reviewer").length).toBeGreaterThan(0);
    expect(within(table).getByText("Style Checker")).toBeInTheDocument();

    // Status badges
    expect(within(table).getByText("Succeeded")).toBeInTheDocument();
    expect(within(table).getByText("No findings")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();

    // Source display — GHA appears for run-1 and run-2
    expect(within(table).getAllByText("GitHub Actions").length).toBeGreaterThan(0);
    expect(within(table).getByText("CircleCI")).toBeInTheDocument();

    // Cost formatting for run-1
    expect(within(table).getByText("$0.015")).toBeInTheDocument();

    // No empty state shown
    expect(
      screen.queryByRole("heading", { name: /no ci runs yet/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the empty state when the runs list is empty", () => {
    vi.mocked(useCiRuns).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useCiRuns>);

    renderWithProviders(<CiRunsView />);

    expect(screen.getByRole("heading", { name: /no ci runs yet/i })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Once you export an agent to CI, every automated review shows up here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set up ci for an agent/i }),
    ).toBeInTheDocument();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows loading skeletons while data is fetching", () => {
    vi.mocked(useCiRuns).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useCiRuns>);

    renderWithProviders(<CiRunsView />);

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("clicking Refresh calls the refresh mutation", () => {
    renderWithProviders(<CiRunsView />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it("status filter chip narrows the visible list to matching rows only", async () => {
    renderWithProviders(<CiRunsView />);

    const table = screen.getByRole("table");

    // All three rows are visible initially
    expect(within(table).getByText("#42")).toBeInTheDocument();
    expect(within(table).getByText("#41")).toBeInTheDocument();
    expect(within(table).getByText("Style Checker")).toBeInTheDocument();

    // Filter to "failed" — only run-3 (Style Checker) should remain
    const statusSelect = screen.getByRole("combobox", { name: /status filter/i });
    fireEvent.change(statusSelect, { target: { value: "failed" } });

    await waitFor(() => {
      const filteredTable = screen.getByRole("table");
      // run-3 row still visible
      expect(within(filteredTable).getByText("Style Checker")).toBeInTheDocument();
      // run-1 and run-2 are gone from the table body
      expect(within(filteredTable).queryByText("#42")).not.toBeInTheDocument();
      expect(within(filteredTable).queryByText("#41")).not.toBeInTheDocument();
    });
  });

  it("shows no-match message when combined filters produce no results", async () => {
    renderWithProviders(<CiRunsView />);

    // Filter agent = "Style Checker" + status = "succeeded":
    // run-3 is Style Checker but "failed", so no run matches both filters.
    const agentSelect = screen.getByRole("combobox", { name: /agent filter/i });
    fireEvent.change(agentSelect, { target: { value: "Style Checker" } });

    const statusSelect = screen.getByRole("combobox", { name: /status filter/i });
    fireEvent.change(statusSelect, { target: { value: "succeeded" } });

    await waitFor(() => {
      expect(
        screen.getByText("No runs match your current filters."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });

  it("auto-refresh indicator is visible", () => {
    renderWithProviders(<CiRunsView />);
    expect(screen.getByText("auto-refresh on")).toBeInTheDocument();
  });
});
