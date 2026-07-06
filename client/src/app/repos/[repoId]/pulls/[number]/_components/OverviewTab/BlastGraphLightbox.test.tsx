import React from "react";
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BlastGraphLightbox } from "./BlastGraphLightbox";

// jsdom does not provide ResizeObserver — stub it minimally.
class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).ResizeObserver = ResizeObserverStub;
});

afterEach(cleanup);

const BLAST: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }],
      endpoints_affected: ["GET /public/data"],
      crons_affected: [],
    },
  ],
  summary: "1 symbol(s) changed · 1 caller(s) · 1 endpoint(s) affected.",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BlastGraphLightbox", () => {
  it("renders in a portal with role=dialog", () => {
    const onClose = vi.fn();
    renderWithIntl(<BlastGraphLightbox blast={BLAST} onClose={onClose} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ESC key calls onClose", () => {
    const onClose = vi.fn();
    renderWithIntl(<BlastGraphLightbox blast={BLAST} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the overlay calls onClose", () => {
    const onClose = vi.fn();
    renderWithIntl(<BlastGraphLightbox blast={BLAST} onClose={onClose} />);
    // The overlay is the dialog's parent element (the portal root div).
    // Clicking it (not the inner dialog) fires onClose.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("close button receives initial focus on open", () => {
    const onClose = vi.fn();
    renderWithIntl(<BlastGraphLightbox blast={BLAST} onClose={onClose} />);
    const closeBtn = screen.getByRole("button", { name: blastMessages.closeGraph });
    expect(closeBtn).toHaveFocus();
  });

  it("Tab key does not move focus outside the dialog", () => {
    const onClose = vi.fn();
    renderWithIntl(<BlastGraphLightbox blast={BLAST} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Tab" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
