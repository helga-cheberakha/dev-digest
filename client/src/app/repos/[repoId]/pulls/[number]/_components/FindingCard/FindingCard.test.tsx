import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

// Queries use the aria-label value, which becomes the accessible name per ARIA spec.
const EVAL_BTN_NAME = /turn this finding into an eval case/i;

describe("FindingCard — eval case button", () => {
  it("renders 'Turn into eval case' disabled for a decision-less finding", () => {
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onCreateEvalCase={() => {}} />,
    );
    const btn = screen.getByRole("button", { name: EVAL_BTN_NAME });
    expect(btn).toBeDisabled();
  });

  it("enables the button once the finding is accepted", () => {
    const accepted: typeof FINDING = { ...FINDING, accepted_at: "2024-01-01T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onCreateEvalCase={() => {}} />,
    );
    expect(screen.getByRole("button", { name: EVAL_BTN_NAME })).toBeEnabled();
  });

  it("enables the button once the finding is dismissed", () => {
    const dismissed: typeof FINDING = { ...FINDING, dismissed_at: "2024-01-01T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={dismissed} defaultExpanded onCreateEvalCase={() => {}} />,
    );
    expect(screen.getByRole("button", { name: EVAL_BTN_NAME })).toBeEnabled();
  });

  it("fires onCreateEvalCase with the finding id when clicked", () => {
    const onCreateEvalCase = vi.fn();
    const accepted: typeof FINDING = { ...FINDING, accepted_at: "2024-01-01T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onCreateEvalCase={onCreateEvalCase} />,
    );
    fireEvent.click(screen.getByRole("button", { name: EVAL_BTN_NAME }));
    expect(onCreateEvalCase).toHaveBeenCalledTimes(1);
    expect(onCreateEvalCase).toHaveBeenCalledWith("f1");
  });
});
