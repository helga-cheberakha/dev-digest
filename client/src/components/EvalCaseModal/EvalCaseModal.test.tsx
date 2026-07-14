/**
 * EvalCaseModal tests.
 *
 * Key invariants verified:
 * 1. Cancel fires ZERO createEvalCase calls (review-before-save guarantee).
 * 2. Save fires exactly ONE createEvalCase call.
 * 3. Save with "Run on save" toggled on fires createEvalCase THEN runEvalCase.
 * 4. Blank open (null expected_output) defaults to one empty region row; Save is
 *    disabled until name + expectation + all rows are valid (no empty file,
 *    no start_line > end_line, at least one row).
 * 5. Removing all region rows disables Save.
 * 6. Stored expected_output is hydrated into prefilled rows — one row per region
 *    plus preselected expectation — from both single- and multi-region sources.
 * 7. The Diff tab defaults to a read-only colorized preview when input_diff is
 *    non-empty, with an Edit-diff toggle back to the raw textarea.
 * 8. After "Run case" resolves, the status line upgrades to the rich
 *    expected/got/duration/cost summary from the fresh EvalRun result.
 * 9. "+ Add region" appends a new empty row; remove deletes only that row.
 * 10. Save submits expected_output with the correct serialized expectation and
 *     regions array (AC-27 / AC-28).
 *
 * Uses fireEvent only — @testing-library/user-event is not installed
 * (client/INSIGHTS.md 2026-07-06).
 *
 * next-intl is provided via NextIntlClientProvider wrapping all renders.
 * @tanstack/react-query is provided via QueryClientProvider.
 * @devdigest/ui Modal uses a fixed overlay — no special jsdom setup needed.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import evalMessages from "../../../messages/en/eval.json";
import { EvalCaseModal } from "./EvalCaseModal";
import type { EvalCaseInput, EvalCase } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Mock the api module
// ---------------------------------------------------------------------------
vi.mock("@/lib/api", () => ({
  createEvalCase: vi.fn(),
  updateEvalCase: vi.fn(),
  runEvalCase: vi.fn(),
  fetchEvalCases: vi.fn(),
  evalQueryKeys: {
    cases: (agentId: string) => ["eval-cases", agentId],
  },
}));

import {
  createEvalCase,
  updateEvalCase,
  runEvalCase,
  fetchEvalCases,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL: EvalCaseInput = {
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "stripe-key-leak",
  input_diff:
    "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1 +1,2 @@\n+const key = 'sk_live_abc';",
  input_files: null,
  input_meta: null,
  expected_output: {
    expectation: "must_find",
    regions: [{ file: "src/config.ts", start_line: 1, end_line: 1 }],
  },
  notes: null,
};

const SAVED_CASE: EvalCase = {
  id: "case-1",
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "stripe-key-leak",
  input_diff: INITIAL.input_diff,
  input_files: null,
  input_meta: null,
  expected_output: INITIAL.expected_output,
};

const FRESH_RUN_RESULT = {
  run_id: "run-1",
  case_id: "case-1",
  result: {
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 1,
    duration_ms: 1800,
    cost_usd: 0.02,
    per_trace: [
      {
        name: "stripe-key-leak",
        pass: true,
        expected: { regions: [{ file: "src/config.ts", start_line: 1, end_line: 1 }] },
        actual: {
          findings: [
            {
              id: "f1",
              severity: "CRITICAL",
              category: "security",
              title: "x",
              file: "src/config.ts",
              start_line: 1,
              end_line: 1,
            },
          ],
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderModal(
  props: Partial<Parameters<typeof EvalCaseModal>[0]> & {
    onSaved?: (c: EvalCase) => void;
    onClose?: () => void;
  } = {},
) {
  const onSaved = props.onSaved ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const qc = makeQueryClient();

  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalCaseModal
          agentName="Security Reviewer"
          initial={INITIAL}
          onSaved={onSaved}
          onClose={onClose}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(createEvalCase).mockResolvedValue(SAVED_CASE);
  vi.mocked(updateEvalCase).mockResolvedValue(SAVED_CASE);
  vi.mocked(runEvalCase).mockResolvedValue(FRESH_RUN_RESULT);
  vi.mocked(fetchEvalCases).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalCaseModal", () => {
  // -- Core behaviour (unchanged) --

  it("clicking Cancel fires zero createEvalCase calls", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(createEvalCase).not.toHaveBeenCalled();
  });

  it("renders the agent name in the subtitle", () => {
    renderModal({ agentName: "Security Reviewer" });
    expect(screen.getByText(/security reviewer.*simulate a pr/i)).toBeInTheDocument();
  });

  it("falls back to a generic subtitle when agentName is omitted", () => {
    renderModal({ agentName: undefined });
    expect(screen.getByText(/^simulate a pr and assert the expected output$/i)).toBeInTheDocument();
  });

  it("clicking Save fires exactly one createEvalCase call", async () => {
    const onSaved = vi.fn();
    renderModal({ onSaved });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(createEvalCase).toHaveBeenCalledOnce();
    });
    expect(runEvalCase).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(SAVED_CASE);
  });

  it("Save with 'Run on save' toggled on fires createEvalCase THEN runEvalCase", async () => {
    const onSaved = vi.fn();
    renderModal({ onSaved });

    // Toggle "Run on save" switch
    const toggle = screen.getByRole("switch", { name: /run on save/i });
    fireEvent.click(toggle);

    // Save
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(SAVED_CASE);
    });

    // createEvalCase must have been called before runEvalCase
    const createOrder = vi.mocked(createEvalCase).mock.invocationCallOrder[0] ?? 0;
    const runOrder = vi.mocked(runEvalCase).mock.invocationCallOrder[0] ?? 0;
    expect(createEvalCase).toHaveBeenCalledOnce();
    expect(runEvalCase).toHaveBeenCalledOnce();
    expect(runEvalCase).toHaveBeenCalledWith(SAVED_CASE.id);
    expect(createOrder).toBeLessThan(runOrder);
  });

  // -- Diff tab: preview / edit toggle (fixed textarea counts) --

  it("Diff tab defaults to a read-only colorized preview when input_diff is non-empty", () => {
    renderModal();

    // The raw diff text is not inside an editable textarea by default.
    const textareaElements = Array.from(document.querySelectorAll("textarea"));
    expect(textareaElements).toHaveLength(0); // diff is in preview mode; no expected_output textarea

    expect(screen.getByText(/const key = 'sk_live_abc'/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit diff/i })).toBeInTheDocument();
  });

  it("clicking 'Edit diff' switches the Diff tab to an editable textarea", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /edit diff/i }));

    expect(screen.getByRole("button", { name: /preview diff/i })).toBeInTheDocument();
    const textareaElements = Array.from(document.querySelectorAll("textarea"));
    expect(textareaElements).toHaveLength(1); // diff textarea only (no expected_output textarea)
  });

  // -- Edit mode: Run case + status lines (unchanged) --

  it("renders Run case button when caseId is provided (edit mode)", () => {
    renderModal({ caseId: "case-1" });

    expect(screen.getByRole("button", { name: /run case/i })).toBeInTheDocument();
  });

  it("Run case button calls runEvalCase(caseId) — does not call createEvalCase", async () => {
    renderModal({ caseId: "case-1" });

    fireEvent.click(screen.getByRole("button", { name: /run case/i }));

    await waitFor(() => {
      expect(runEvalCase).toHaveBeenCalledWith("case-1");
    });
    expect(createEvalCase).not.toHaveBeenCalled();
  });

  it("clicking Save in edit mode calls updateEvalCase(caseId, input) — does not duplicate via createEvalCase", async () => {
    const onSaved = vi.fn();
    renderModal({ caseId: "case-1", onSaved });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(updateEvalCase).toHaveBeenCalledOnce();
    });
    expect(updateEvalCase).toHaveBeenCalledWith("case-1", expect.objectContaining({ name: INITIAL.name }));
    expect(createEvalCase).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(SAVED_CASE);
  });

  it("after Run case resolves, the status line shows the rich expected/got/duration/cost summary", async () => {
    renderModal({ caseId: "case-1" });

    fireEvent.click(screen.getByRole("button", { name: /run case/i }));

    expect(
      await screen.findByText(/last run passed.*expected 1 finding, got 1.*1\.8s.*\$0\.02/i),
    ).toBeInTheDocument();
  });

  it("last-run status shows 'Never run' when latest_run is null (edit mode)", async () => {
    vi.mocked(fetchEvalCases).mockResolvedValue([
      {
        id: "case-1",
        owner_kind: "agent",
        owner_id: "agent-1",
        name: "stripe-key-leak",
        input_diff: "diff",
        input_files: null,
        input_meta: null,
        expected_output: { expectation: "must_find", regions: [] },
        notes: null,
        latest_run: null,
      },
    ] as ReturnType<typeof fetchEvalCases> extends Promise<infer T> ? T : never);

    renderModal({ caseId: "case-1" });

    // "Never run" appears as soon as edit mode is active (even before fetch resolves)
    // and stays after the fetch since latest_run is null
    expect(await screen.findByText("Never run")).toBeInTheDocument();
  });

  it("last-run status renders pass/fail and metrics when latest_run is non-null (edit mode)", async () => {
    vi.mocked(fetchEvalCases).mockResolvedValue([
      {
        id: "case-1",
        owner_kind: "agent",
        owner_id: "agent-1",
        name: "stripe-key-leak",
        input_diff: "diff",
        input_files: null,
        input_meta: null,
        expected_output: { expectation: "must_find", regions: [] },
        notes: null,
        latest_run: {
          pass: true,
          recall: 0.9,
          precision: 0.85,
          citation_accuracy: 0.8,
          ran_at: "2026-07-10T12:00:00Z",
        },
      },
    ] as ReturnType<typeof fetchEvalCases> extends Promise<infer T> ? T : never);

    renderModal({ caseId: "case-1" });

    // After the query resolves, the status line should show pass status + real metrics
    expect(
      await screen.findByText(/last run passed.*recall 90%.*precision 85%.*citation 80%/i),
    ).toBeInTheDocument();
  });

  // -- New: structured region form behaviour --

  it("blank open (null expected_output) initializes exactly one empty region row (AC-30)", () => {
    renderModal({ initial: { ...INITIAL, expected_output: null } });

    const fileInputs = screen.getAllByRole("textbox", { name: /^file$/i });
    expect(fileInputs).toHaveLength(1);
    expect((fileInputs[0] as HTMLInputElement).value).toBe("");
  });

  it("Save is disabled after removing the last region row (AC-31)", () => {
    renderModal();

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled(); // starts with one valid row

    fireEvent.click(screen.getByRole("button", { name: /remove region/i }));

    expect(saveBtn).toBeDisabled(); // zero rows → saveDisabled
  });

  it("Save is disabled when region file is empty, re-enabled after filling it in (AC-32)", () => {
    // null expected_output → one row with empty file → isRowInvalid → Save disabled
    renderModal({ initial: { ...INITIAL, expected_output: null } });

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    const fileInput = screen.getByRole("textbox", { name: /^file$/i });
    fireEvent.change(fileInput, { target: { value: "src/config.ts" } });

    expect(saveBtn).not.toBeDisabled();
  });

  it("Save is disabled when start_line > end_line, re-enabled after fixing it (AC-32)", () => {
    renderModal();

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();

    const endLineInput = screen.getByRole("spinbutton", { name: /end line/i });
    fireEvent.change(endLineInput, { target: { value: "0" } }); // start=1 > end=0 → invalid

    expect(saveBtn).toBeDisabled();

    fireEvent.change(endLineInput, { target: { value: "5" } }); // start=1 ≤ end=5 → valid
    expect(saveBtn).not.toBeDisabled();
  });

  it("Save is enabled when name, expectation, and all region rows are valid (AC-33)", () => {
    // INITIAL: name="stripe-key-leak", 1 region with file="src/config.ts", start=1 ≤ end=1
    renderModal();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("hydrates a single-region stored case into one prefilled row (AC-34)", () => {
    renderModal({
      initial: {
        ...INITIAL,
        expected_output: {
          expectation: "must_not_flag",
          regions: [{ file: "src/auth.ts", start_line: 3, end_line: 7 }],
        },
      },
    });

    const fileInputs = screen.getAllByRole("textbox", { name: /^file$/i });
    expect(fileInputs).toHaveLength(1);
    expect((fileInputs[0] as HTMLInputElement).value).toBe("src/auth.ts");

    const startLine = screen.getByRole("spinbutton", { name: /start line/i }) as HTMLInputElement;
    const endLine = screen.getByRole("spinbutton", { name: /end line/i }) as HTMLInputElement;
    expect(startLine.value).toBe("3");
    expect(endLine.value).toBe("7");

    // Expectation combobox is the first <select> rendered in the right column
    const expectationSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(expectationSelect.value).toBe("must_not_flag");
  });

  it("hydrates a multi-region stored case into one prefilled row per region (AC-34)", () => {
    renderModal({
      initial: {
        ...INITIAL,
        expected_output: {
          expectation: "must_find",
          regions: [
            { file: "src/a.ts", start_line: 1, end_line: 2 },
            { file: "src/b.ts", start_line: 10, end_line: 20 },
          ],
        },
      },
    });

    const removeButtons = screen.getAllByRole("button", { name: /remove region/i });
    expect(removeButtons).toHaveLength(2);

    // Each remove button lives at: button → flex-div → row-container (2 levels up).
    // Scope within each row container to avoid ambiguous multi-region queries.
    const row1 = removeButtons[0]!.parentElement!.parentElement!;
    const row2 = removeButtons[1]!.parentElement!.parentElement!;

    expect(
      (within(row1).getByRole("textbox", { name: /^file$/i }) as HTMLInputElement).value,
    ).toBe("src/a.ts");
    expect(
      (within(row2).getByRole("textbox", { name: /^file$/i }) as HTMLInputElement).value,
    ).toBe("src/b.ts");
    expect(
      (within(row2).getByRole("spinbutton", { name: /start line/i }) as HTMLInputElement).value,
    ).toBe("10");
  });

  it("'+ Add region' appends a new row; remove deletes only that specific row (AC-29)", () => {
    renderModal(); // starts with 1 region: file="src/config.ts"

    expect(screen.getAllByRole("textbox", { name: /^file$/i })).toHaveLength(1);

    // Add a second region
    fireEvent.click(screen.getByRole("button", { name: /\+ add region/i }));

    const fileInputsAfterAdd = screen.getAllByRole("textbox", { name: /^file$/i });
    expect(fileInputsAfterAdd).toHaveLength(2);

    // Distinguish the second row by filling in its file
    fireEvent.change(fileInputsAfterAdd[1]!, { target: { value: "src/other.ts" } });

    // Remove the first row — second row must survive intact
    const removeButtons = screen.getAllByRole("button", { name: /remove region/i });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]!);

    const remaining = screen.getAllByRole("textbox", { name: /^file$/i });
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as HTMLInputElement).value).toBe("src/other.ts");
  });

  it("Save submits expected_output with correct serialized expectation and regions (AC-27 / AC-28)", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(createEvalCase).toHaveBeenCalledOnce();
    });

    const payload = vi.mocked(createEvalCase).mock.calls[0]![0];
    expect(payload).toMatchObject({
      expected_output: {
        expectation: "must_find",
        regions: [{ file: "src/config.ts", start_line: 1, end_line: 1 }],
      },
    });
    // Explicit length check — regions must not have extra elements
    const eo = payload.expected_output as { regions: unknown[] };
    expect(eo.regions).toHaveLength(1);
  });
});
