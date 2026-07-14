import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import prBriefMessages from "../../../../../../../../messages/en/prBrief.json";
import { ReviewFocusSection } from "./ReviewFocusSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prBrief: prBriefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ITEMS: ReviewFocusItem[] = [
  {
    label: "Rate limiting middleware",
    file_refs: ["src/mw/ratelimit.ts:12-20"],
  },
  {
    label: "Public API handler",
    file_refs: ["src/api/public.ts"],
  },
];

describe("ReviewFocusSection", () => {
  it("renders count badge with the correct number", () => {
    renderWithIntl(<ReviewFocusSection items={ITEMS} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders each row with the correct file_ref text and label text", () => {
    renderWithIntl(<ReviewFocusSection items={ITEMS} />);
    expect(screen.getByText("src/mw/ratelimit.ts:12-20")).toBeInTheDocument();
    expect(screen.getByText("Rate limiting middleware")).toBeInTheDocument();
    expect(screen.getByText("src/api/public.ts")).toBeInTheDocument();
    expect(screen.getByText("Public API handler")).toBeInTheDocument();
  });

  it("calls onOpenFile with parsed target for a line-range file_ref", () => {
    const onOpenFile = vi.fn();
    renderWithIntl(<ReviewFocusSection items={ITEMS} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("src/mw/ratelimit.ts:12-20"));
    expect(onOpenFile).toHaveBeenCalledWith({ path: "src/mw/ratelimit.ts", line: 12 });
  });

  it("calls onOpenFile with parsed target for a bare-path file_ref", () => {
    const onOpenFile = vi.fn();
    renderWithIntl(<ReviewFocusSection items={ITEMS} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("src/api/public.ts"));
    expect(onOpenFile).toHaveBeenCalledWith({ path: "src/api/public.ts" });
  });

  it("renders empty-state message when items is empty", () => {
    renderWithIntl(<ReviewFocusSection items={[]} />);
    expect(screen.getByText(prBriefMessages.reviewFocusEmpty)).toBeInTheDocument();
  });
});
