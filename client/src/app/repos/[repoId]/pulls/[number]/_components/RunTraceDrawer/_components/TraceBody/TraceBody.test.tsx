/* TraceBody — Project context block (AC-25).
   Tests that `prompt_assembly.specs` is rendered as an expandable, inert
   preformatted block when non-null, and absent when null. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

afterEach(cleanup);

function renderWithIntl(trace: RunTrace, findings: FindingRecord[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <TraceBody trace={trace} findings={findings} />
    </NextIntlClientProvider>,
  );
}

const BASE_TRACE: RunTrace = {
  config: {
    agent: "Security",
    version: "1",
    provider: "openai",
    model: "gpt-4.1",
    pr: 482,
    source: "local",
  },
  stats: {
    duration_ms: 8200,
    tokens_in: 12000,
    tokens_out: 1500,
    cost_usd: 0.06,
    findings: 2,
    grounding: "2/2 passed",
  },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: null,
    memory: null,
    specs: null,
    user: "Review PR #482",
  },
  tool_calls: [],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [],
  specs_read: [],
  log: [],
};

describe("TraceBody — Project context block (AC-25)", () => {
  it("renders an expandable block with verbatim text when specs is non-null", () => {
    const specContent =
      '<untrusted source="spec-0">Do not import db from api module.</untrusted>';
    const trace: RunTrace = {
      ...BASE_TRACE,
      prompt_assembly: { ...BASE_TRACE.prompt_assembly, specs: specContent },
    };
    renderWithIntl(trace);

    // The "Prompt assembly" TraceSection defaults to collapsed — expand it first
    fireEvent.click(screen.getByText("Prompt assembly"));

    // Block label is now visible (PromptBlock itself is collapsed by default)
    expect(
      screen.getByText("Project context — attached specs (untrusted)"),
    ).toBeInTheDocument();

    // Click the block label to expand it and reveal the verbatim content
    fireEvent.click(
      screen.getByText("Project context — attached specs (untrusted)"),
    );

    // Verbatim text appears — rendered as plain text inside <pre>, not as HTML
    expect(screen.getByText(specContent)).toBeInTheDocument();

    // Verify the text node is inside a <pre> element (inert rendering)
    const preEl = screen.getByText(specContent).closest("pre");
    expect(preEl).not.toBeNull();
  });

  it("renders no project-context block when specs is null", () => {
    renderWithIntl(BASE_TRACE);
    expect(
      screen.queryByText("Project context — attached specs (untrusted)"),
    ).not.toBeInTheDocument();
  });
});
