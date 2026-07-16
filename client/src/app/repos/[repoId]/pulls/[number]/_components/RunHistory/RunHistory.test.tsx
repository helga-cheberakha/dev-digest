/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    multi_agent_run_id: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], onViewMultiAgentRun?: (id: string) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} onViewMultiAgentRun={onViewMultiAgentRun} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("a settled run shows total tokens · cost; a missing cost shows '—' not '$0.00'", () => {
    renderRuns([
      run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013, score: 80 }),
    ]);
    expect(screen.getByText(/9,119 tok · \$0\.0013/)).toBeInTheDocument();

    cleanup();
    renderRuns([run({ status: "done", tokens_in: 0, tokens_out: 0, cost_usd: null, score: 80 })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — multi-agent fan-out grouping", () => {
  it("groups runs sharing a multi_agent_run_id into ONE batch row, not N disconnected rows", () => {
    renderRuns([
      run({ run_id: "r1", agent_id: "a1", agent_name: "Security", status: "done", cost_usd: 0.02, duration_ms: 3000, multi_agent_run_id: "ma-1" }),
      run({ run_id: "r2", agent_id: "a2", agent_name: "Performance", status: "done", cost_usd: 0.01, duration_ms: 5000, multi_agent_run_id: "ma-1" }),
    ]);

    // One combined row, not two agent names rendered as separate run rows
    expect(screen.getByText(/multi-agent review/i)).toBeInTheDocument();
    expect(screen.getByText(/2 agents/i)).toBeInTheDocument();
    expect(screen.queryByText("Security")).not.toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();

    // total_duration_ms = MAX (5s), not sum (8s) — AC-28 convention
    expect(screen.getByText(/5\.0s/)).toBeInTheDocument();
    expect(screen.queryByText(/8\.0s/)).not.toBeInTheDocument();
    // total_cost_usd = SUM
    expect(screen.getByText(/\$0\.03/)).toBeInTheDocument();
  });

  it("a run with no multi_agent_run_id renders as a normal standalone row", () => {
    renderRuns([run({ run_id: "solo", agent_name: "Security", multi_agent_run_id: null })]);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.queryByText(/multi-agent review/i)).not.toBeInTheDocument();
  });

  it("clicking 'View results' on a batch row calls onViewMultiAgentRun with the parent id", () => {
    const onView = vi.fn();
    renderRuns(
      [
        run({ run_id: "r1", multi_agent_run_id: "ma-42" }),
        run({ run_id: "r2", multi_agent_run_id: "ma-42" }),
      ],
      onView,
    );

    screen.getByText("View results").click();
    expect(onView).toHaveBeenCalledWith("ma-42");
  });

  it("a batch containing a failed run reads the worst-case outcome, not 'approved'", () => {
    renderRuns([
      run({ run_id: "r1", status: "done", blockers: 0, findings_count: 0, multi_agent_run_id: "ma-1" }),
      run({ run_id: "r2", status: "failed", error: "boom", score: null, blockers: null, multi_agent_run_id: "ma-1" }),
    ]);
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.queryByText("approved")).not.toBeInTheDocument();
  });
});
