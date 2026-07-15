import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

// Hoist the push mock so the vi.mock factory closure can reference it safely.
// vi.hoisted() runs before the mocks and before any module-level code.
const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/multiAgent", () => ({
  useAgentEstimates: vi.fn(),
  useLaunchMultiAgentRun: vi.fn(),
}));

import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunReview } from "../../../../../../../lib/hooks/reviews";
import {
  useAgentEstimates,
  useLaunchMultiAgentRun,
} from "../../../../../../../lib/hooks/multiAgent";
import { RunReviewDropdown } from "./RunReviewDropdown";

// ---- Fixtures ----

const AGENT_A = { id: "a1", name: "Security", model: "gpt-4.1", enabled: true };
const AGENT_B = { id: "a2", name: "Performance", model: "gpt-4.1", enabled: true };
const AGENT_DISABLED = { id: "a3", name: "Hidden", model: "gpt-4.1", enabled: false };

const ESTIMATES = [
  { agent_id: "a1", est_duration_ms: 5000, est_cost_usd: 0.02, last_run_summary: null },
  { agent_id: "a2", est_duration_ms: null, est_cost_usd: null, last_run_summary: null },
];

// ---- Helpers ----

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function openDropdown() {
  fireEvent.click(screen.getByText("Run Review"));
}

// ---- Default mock setup (reset before each test) ----

beforeEach(() => {
  pushMock.mockReset();

  vi.mocked(useRunReview).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({
      runs: [{ run_id: "run1" }],
      pr_id: "pr1",
      reviews: [],
    }),
    isPending: false,
  } as any);

  vi.mocked(useAgentEstimates).mockReturnValue({
    data: ESTIMATES,
  } as any);

  vi.mocked(useLaunchMultiAgentRun).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: "mar1", run_ids: ["run1", "run2"] }),
    isPending: false,
  } as any);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ---- Tests ----

describe("RunReviewDropdown — multi-agent picker", () => {
  it("renders the trigger button", () => {
    vi.mocked(useAgents).mockReturnValue({ data: [AGENT_A] } as any);
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("renders one checkbox row per ENABLED agent with estimate label", () => {
    // AGENT_DISABLED must not appear; AGENT_B's null estimates show "—"
    vi.mocked(useAgents).mockReturnValue({
      data: [AGENT_A, AGENT_DISABLED],
    } as any);
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    // Only enabled agent renders a checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(1);

    // Agent name is visible
    expect(screen.getByText("Security")).toBeInTheDocument();

    // Estimate label: 5s · $0.02 (from ESTIMATES[0])
    expect(screen.getByText(/5s/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.02/)).toBeInTheDocument();
  });

  it('"Select all" checks all checkboxes and label flips to "Clear"; "Clear" unchecks all', () => {
    vi.mocked(useAgents).mockReturnValue({ data: [AGENT_A, AGENT_B] } as any);
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    const checkboxes = () => screen.getAllByRole("checkbox");
    expect(checkboxes()).toHaveLength(2);
    checkboxes().forEach((cb) => expect(cb).toHaveAttribute("aria-checked", "false"));

    // Select all
    fireEvent.click(screen.getByRole("button", { name: /select all/i }));

    checkboxes().forEach((cb) => expect(cb).toHaveAttribute("aria-checked", "true"));
    // Button label flips to "Clear"
    expect(screen.getByRole("button", { name: /^clear$/i })).toBeInTheDocument();

    // Clear
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));

    checkboxes().forEach((cb) => expect(cb).toHaveAttribute("aria-checked", "false"));
    // Button label flips back to "Select all"
    expect(screen.getByRole("button", { name: /select all/i })).toBeInTheDocument();
  });

  it("N=1: shows 'Run <name>' and calls the single-agent path (not multi-agent endpoint)", async () => {
    const singleMutate = vi.fn().mockResolvedValue({
      runs: [{ run_id: "run1" }],
      pr_id: "pr1",
      reviews: [],
    });
    const multiMutate = vi.fn();
    vi.mocked(useRunReview).mockReturnValue({ mutateAsync: singleMutate, isPending: false } as any);
    vi.mocked(useLaunchMultiAgentRun).mockReturnValue({
      mutateAsync: multiMutate,
      isPending: false,
    } as any);
    vi.mocked(useAgents).mockReturnValue({ data: [AGENT_A] } as any);

    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    // Check the Security agent checkbox (non-null assert: RTL throws if not present)
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    // Action label shows single-agent wording
    expect(screen.getByText("Run Security")).toBeInTheDocument();

    // Click run
    fireEvent.click(screen.getByText("Run Security"));

    await waitFor(() => {
      expect(singleMutate).toHaveBeenCalledWith({ prId: "pr1", agentId: "a1" });
    });
    // Multi-agent endpoint must NOT be called
    expect(multiMutate).not.toHaveBeenCalled();
    // No navigation to multi-agent page
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining("/multi-agent/mar"));
  });

  it("N≥2: shows 'Run multi-agent review (N)', calls multi-agent launch, navigates to /multi-agent/<id>", async () => {
    const launchMutate = vi.fn().mockResolvedValue({ id: "mar1", run_ids: ["r1", "r2"] });
    vi.mocked(useLaunchMultiAgentRun).mockReturnValue({
      mutateAsync: launchMutate,
      isPending: false,
    } as any);
    vi.mocked(useAgents).mockReturnValue({ data: [AGENT_A, AGENT_B] } as any);

    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    // Select both agents
    fireEvent.click(screen.getByRole("button", { name: /select all/i }));

    expect(screen.getByText("Run multi-agent review (2)")).toBeInTheDocument();

    // Click run
    fireEvent.click(screen.getByText("Run multi-agent review (2)"));

    await waitFor(() => {
      expect(launchMutate).toHaveBeenCalledWith({ prId: "pr1", agent_ids: ["a1", "a2"] });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/multi-agent/mar1");
    });
  });

  it('"Configure agents…" navigates to /multi-agent/configure?prId=<prId>', () => {
    vi.mocked(useAgents).mockReturnValue({ data: [AGENT_A] } as any);
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    fireEvent.click(screen.getByText("Configure agents…"));

    expect(pushMock).toHaveBeenCalledWith("/multi-agent/configure?prId=pr1");
  });
});
