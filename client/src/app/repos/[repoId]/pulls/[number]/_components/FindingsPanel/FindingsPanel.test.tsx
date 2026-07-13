import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, EvalCaseInput, EvalCaseListItem } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/api", () => ({
  draftEvalCaseFromFinding: vi.fn(),
  createEvalCase: vi.fn(),
  fetchEvalCases: vi.fn().mockResolvedValue([]),
  evalQueryKeys: { cases: (agentId: string) => ["eval-cases", agentId] },
}));

vi.mock("@/components/EvalCaseModal", () => ({
  EvalCaseModal: ({
    initial,
    caseId,
    onSaved,
  }: {
    initial: EvalCaseInput;
    caseId?: string;
    onSaved: (c: unknown) => void;
  }) => (
    <div
      data-testid="eval-case-modal"
      data-expected-output={JSON.stringify(initial.expected_output)}
      data-case-id={caseId ?? ""}
    >
      <button onClick={() => onSaved({ id: "new-case" })}>mock-save</button>
    </div>
  ),
}));

import { draftEvalCaseFromFinding, createEvalCase, fetchEvalCases } from "@/lib/api";
import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const BASE_FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const FINDINGS: FindingRecord[] = [BASE_FINDING];

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

// The button's accessible name comes from aria-label, not visible text.
const EVAL_BTN_NAME = /turn this finding into an eval case/i;

describe("FindingsPanel — eval case flow", () => {
  const DRAFT: EvalCaseInput = {
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "finding-derived",
    input_diff:
      "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1 +1,2 @@\n+const key = 'sk_live_abc';",
    input_files: null,
    input_meta: null,
    expected_output: {
      expectation: "must_find",
      regions: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
    },
    notes: null,
  };

  it("clicking the eval case button on a resolved finding fires draftEvalCaseFromFinding once, renders EvalCaseModal with non-empty expected_output, and does NOT call createEvalCase", async () => {
    vi.mocked(draftEvalCaseFromFinding).mockResolvedValue(DRAFT);

    const resolvedFinding: FindingRecord = {
      ...BASE_FINDING,
      accepted_at: "2024-01-01T00:00:00Z",
    };

    renderWithIntl(<FindingsPanel findings={[resolvedFinding]} prId="pr1" />);

    // The first card is defaultExpanded — the eval case button is visible
    const evalBtn = screen.getByRole("button", { name: EVAL_BTN_NAME });
    expect(evalBtn).toBeEnabled();
    fireEvent.click(evalBtn);

    // Wait for the mutation onSuccess to render the modal
    await waitFor(() => {
      expect(screen.getByTestId("eval-case-modal")).toBeInTheDocument();
    });

    // draftEvalCaseFromFinding called exactly once with the finding id
    // TanStack Query passes a context object as a second argument — ignore it.
    expect(draftEvalCaseFromFinding).toHaveBeenCalledTimes(1);
    expect(vi.mocked(draftEvalCaseFromFinding).mock.calls[0]![0]).toBe("f1");

    // Modal received non-empty expected_output
    const modal = screen.getByTestId("eval-case-modal");
    const expectedOutput = JSON.parse(modal.getAttribute("data-expected-output") ?? "null");
    expect(expectedOutput).not.toBeNull();
    expect(expectedOutput).toHaveProperty("expectation");

    // createEvalCase NOT called — opening the modal never persists
    expect(createEvalCase).not.toHaveBeenCalled();
  });

  it("refetches the agent's eval cases after Save, so the button updates without a page reload", async () => {
    vi.mocked(draftEvalCaseFromFinding).mockResolvedValue(DRAFT);
    vi.mocked(fetchEvalCases).mockResolvedValue([]); // no existing case yet

    const resolvedFinding: FindingRecord = {
      ...BASE_FINDING,
      accepted_at: "2024-01-01T00:00:00Z",
    };

    renderWithIntl(
      <FindingsPanel findings={[resolvedFinding]} prId="pr1" agentId="agent-1" />,
    );

    // Initial mount fetches the agent's eval cases once.
    await waitFor(() => expect(fetchEvalCases).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: EVAL_BTN_NAME }));
    await waitFor(() => {
      expect(screen.getByTestId("eval-case-modal")).toBeInTheDocument();
    });

    // Simulate the modal's Save completing (calls onSaved).
    fireEvent.click(screen.getByText("mock-save"));

    // The cases query is invalidated on save, triggering a second fetch —
    // without this, "hasEvalCase" only reflects the new case after a reload.
    await waitFor(() => expect(fetchEvalCases).toHaveBeenCalledTimes(2));
  });

  const EXISTING_CASE: EvalCaseListItem = {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "finding-derived",
    input_diff: DRAFT.input_diff,
    input_files: null,
    input_meta: { source_finding_id: "f1" },
    expected_output: DRAFT.expected_output,
    notes: null,
    latest_run: null,
  };

  it("opens the existing case (not a fresh draft) when one was already created from this finding", async () => {
    vi.mocked(fetchEvalCases).mockResolvedValue([EXISTING_CASE]);

    const resolvedFinding: FindingRecord = {
      ...BASE_FINDING,
      accepted_at: "2024-01-01T00:00:00Z",
    };

    renderWithIntl(
      <FindingsPanel findings={[resolvedFinding]} prId="pr1" agentId="agent-1" />,
    );

    const viewBtn = await screen.findByRole("button", {
      name: /view the eval case already created from this finding/i,
    });
    fireEvent.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByTestId("eval-case-modal")).toBeInTheDocument();
    });

    // Opens the existing case in edit mode — no duplicate draft fetched.
    expect(screen.getByTestId("eval-case-modal").getAttribute("data-case-id")).toBe("case-1");
    expect(draftEvalCaseFromFinding).not.toHaveBeenCalled();
  });
});
