/**
 * EvalCaseModal tests.
 *
 * Key invariants verified:
 * 1. Cancel fires ZERO createEvalCase calls (review-before-save guarantee).
 * 2. Save fires exactly ONE createEvalCase call.
 * 3. Save with "Run on save" toggled on fires createEvalCase THEN runEvalCase.
 * 4. Invalid expected_output JSON disables the Save button.
 *
 * Uses fireEvent only — @testing-library/user-event is not installed
 * (client/INSIGHTS.md 2026-07-06).
 *
 * next-intl is provided via NextIntlClientProvider wrapping all renders.
 * @tanstack/react-query is provided via QueryClientProvider.
 * @devdigest/ui Modal uses a fixed overlay — no special jsdom setup needed.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
  runEvalCase: vi.fn(),
  fetchEvalCases: vi.fn(),
  evalQueryKeys: {
    cases: (agentId: string) => ["eval-cases", agentId],
  },
}));

import {
  createEvalCase,
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

const VALID_EXPECTED_OUTPUT = JSON.stringify({
  expectation: "must_find",
  regions: [{ file: "src/config.ts", start_line: 1, end_line: 1 }],
});

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
  vi.mocked(runEvalCase).mockResolvedValue({
    run_id: "run-1",
    case_id: "case-1",
    result: {
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 1,
      traces_total: 1,
      duration_ms: 500,
      cost_usd: 0.001,
      per_trace: [],
    },
  });
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
  it("clicking Cancel fires zero createEvalCase calls", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(createEvalCase).not.toHaveBeenCalled();
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

    // Toggle "Run on save" checkbox
    const checkbox = screen.getByRole("checkbox", { name: /run on save/i });
    fireEvent.click(checkbox);

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

  it("typing invalid JSON into expected_output disables the Save button", () => {
    renderModal();

    // Find the expected_output textarea — it is the third textarea (after diff, files, meta areas are not visible)
    // The expected_output textarea is the last one rendered (mono textarea with JSON placeholder)
    const textareas = screen.getAllByRole("textbox");
    // Find the textarea that holds the expected output (not the name input)
    // Name field is a TextInput (input element), so textareas should be the textarea elements
    const textareaElements = Array.from(document.querySelectorAll("textarea"));
    // The expected output textarea is the last one (after diff textarea)
    const expectedOutputTextarea = textareaElements[textareaElements.length - 1]!;

    // Initially valid expected output → Save should be enabled
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();

    // Type invalid JSON
    fireEvent.change(expectedOutputTextarea, { target: { value: "not valid json {{{" } });

    expect(saveBtn).toBeDisabled();
  });

  it("Save button stays disabled when expected_output fails schema validation even with valid JSON", () => {
    renderModal();

    const textareaElements = Array.from(document.querySelectorAll("textarea"));
    const expectedOutputTextarea = textareaElements[textareaElements.length - 1]!;

    // Valid JSON but wrong shape (missing required fields)
    fireEvent.change(expectedOutputTextarea, {
      target: { value: JSON.stringify({ foo: "bar" }) },
    });

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();
  });

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
});
