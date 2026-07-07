/* OnboardingTourView.test.tsx — component tests for the per-repo Onboarding Tour.
   Oracle: spec ACs 20–23 + first-visit flow + a11y NFR (WCAG 2.1 AA).
   Uses fireEvent (not userEvent — @testing-library/user-event is not installed).
   Mocks hooks via vi.mock; no MSW needed (API calls are in hook internals). */

import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingArtifact } from "@devdigest/shared";
import onboardingTourMessages from "../../../../../../../messages/en/onboardingTour.json";

// ---- IntersectionObserver stub (jsdom does not implement it) ----
// The scroll-spy effect calls new IntersectionObserver(…). Without this stub
// the effect throws and every test with rendered data crashes.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    root: null = null;
    rootMargin: string = "";
    thresholds: ReadonlyArray<number> = [];
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// ---- Mock: AppShell passes children through (avoids shell-level global hooks) ----
vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---- Mock: SafeMarkdown renders plain text (avoids remark/rehype deps in jsdom) ----
vi.mock("../../../../../../components/SafeMarkdown", () => ({
  SafeMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

// ---- Mock: onboarding hooks ----
vi.mock("../../../../../../lib/hooks/onboarding", () => ({
  useOnboarding: vi.fn(),
  useGenerateOnboarding: vi.fn(),
}));

import {
  useOnboarding,
  useGenerateOnboarding,
} from "../../../../../../lib/hooks/onboarding";

import { OnboardingTourView } from "./OnboardingTourView";

afterEach(cleanup);

// ---- Test fixtures ----

/** An artifact generated 5 minutes ago — covers the "tour exists" path. */
const ARTIFACT: OnboardingArtifact = {
  repoName: "owner/my-repo",
  filesIndexed: 142,
  generatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  headSha: "abc123",
  sections: {
    architecture: {
      overview: "Modular monolith with three main layers.",
      style: "modular",
      diagram: {
        nodes: [
          { id: "api", label: "api", kind: "file" },
          { id: "db", label: "db", kind: "package" },
        ],
        edges: [{ from: "api", to: "db" }],
      },
    },
    criticalPaths: [
      {
        file: "src/server.ts",
        rationale: "Entry point for all requests.",
        link: "https://github.com/owner/my-repo/blob/abc123/src/server.ts",
      },
    ],
    howToRun: [
      { step: "1", command: "npm install" },
      { step: "2", command: "npm run dev" },
    ],
    readingPath: [
      {
        file: "src/index.ts",
        rationale: "Start here to understand the codebase.",
        link: "https://github.com/owner/my-repo/blob/abc123/src/index.ts",
      },
    ],
    firstTasks: [
      {
        title: "Add missing test for auth module",
        suggestedPath: "src/auth/auth.test.ts",
        gapType: "missing_test",
        rationale: "The auth module has no test coverage.",
        patternPointer: "src/user/user.test.ts",
        complexity: "low",
      },
    ],
  },
};

/** Same as ARTIFACT but with degraded=true (used by the a11y degraded-badge test). */
const DEGRADED_ARTIFACT: OnboardingArtifact = {
  ...ARTIFACT,
  degraded: true,
  degradedReason: "Index is partial.",
};

// ---- Render helper ----

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ onboardingTour: onboardingTourMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---- Tests ----

describe("OnboardingTourView", () => {
  const mockMutate = vi.fn();

  beforeEach(() => {
    // Default: tour exists and is loaded
    vi.mocked(useOnboarding).mockReturnValue({
      data: ARTIFACT,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);
    vi.mocked(useGenerateOnboarding).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as any);
    mockMutate.mockReset();

    // Default clipboard stub — component calls navigator.clipboard.writeText().
    // jsdom does not implement navigator.clipboard, so we stub it.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  // ----------------------------------------------------------------
  // AC-20 — five cards + sticky scroll-spy nav + header + controls
  // ----------------------------------------------------------------
  it("AC-20: renders five collapsible cards, sticky nav, header with repo name / files-indexed / time, and Regenerate/Share controls", () => {
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // --- Header: repo name visible in the h1 ---
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("owner/my-repo");

    // --- Header meta: files-indexed count ---
    // Message: "Generated from index of {filesIndexed} files · last refreshed {timeAgo}"
    expect(
      screen.getByText(/Generated from index of 142 files/i),
    ).toBeInTheDocument();

    // --- Controls: Regenerate and Share buttons present ---
    expect(
      screen.getByRole("button", { name: /Regenerate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Share link/i }),
    ).toBeInTheDocument();

    // --- Sticky "On this page" scroll-spy nav with all five section links ---
    const nav = screen.getByRole("navigation", { name: /On this page/i });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByText("Architecture overview")).toBeInTheDocument();
    expect(within(nav).getByText("Critical paths")).toBeInTheDocument();
    expect(within(nav).getByText("How to run locally")).toBeInTheDocument();
    expect(within(nav).getByText("Guided reading path")).toBeInTheDocument();
    expect(within(nav).getByText("First tasks")).toBeInTheDocument();

    // --- Five collapsible card toggle buttons (one per section) ---
    expect(
      screen.getByRole("button", { name: /Architecture overview/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Critical paths/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /How to run locally/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Guided reading path/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /First tasks/i }),
    ).toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // AC-20 — Regenerate control wires to mutate({ force: true })
  // ----------------------------------------------------------------
  it("AC-20: Regenerate button calls generate.mutate with { force: true }", () => {
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({ force: true });
  });

  // ----------------------------------------------------------------
  // A11y baseline — keyboard expand/collapse via aria-expanded (WCAG 2.1 AA)
  // ----------------------------------------------------------------
  it("a11y: card toggle buttons carry aria-expanded and toggle on click (keyboard-operable)", () => {
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // All cards start open (aria-expanded="true")
    const archBtn = screen.getByRole("button", { name: /Architecture overview/i });
    expect(archBtn).toHaveAttribute("aria-expanded", "true");

    // Collapse via click (simulates Enter / Space for keyboard users)
    fireEvent.click(archBtn);
    expect(archBtn).toHaveAttribute("aria-expanded", "false");

    // Re-expand
    fireEvent.click(archBtn);
    expect(archBtn).toHaveAttribute("aria-expanded", "true");
  });

  // ----------------------------------------------------------------
  // AC-21 — Critical paths Open link: external blob, target=_blank
  // ----------------------------------------------------------------
  it("AC-21: Critical paths 'Open' link is an external anchor (target=_blank) pointing to the source blob URL", () => {
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // Accessible name: aria-label="Open {file} in new tab"
    const openLink = screen.getByRole("link", {
      name: /Open src\/server\.ts in new tab/i,
    });
    expect(openLink).toHaveAttribute(
      "href",
      "https://github.com/owner/my-repo/blob/abc123/src/server.ts",
    );
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  // ----------------------------------------------------------------
  // AC-21 — Reading path file link: external blob, target=_blank
  // ----------------------------------------------------------------
  it("AC-21: Reading path file link is an external anchor (target=_blank) pointing to the source blob URL", () => {
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // ReadingPathRow renders <a aria-label="Open {file} in new tab" href={entry.link} target="_blank">
    const readingLink = screen.getByRole("link", {
      name: /Open src\/index\.ts in new tab/i,
    });
    expect(readingLink).toHaveAttribute(
      "href",
      "https://github.com/owner/my-repo/blob/abc123/src/index.ts",
    );
    expect(readingLink).toHaveAttribute("target", "_blank");
    expect(readingLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  // ----------------------------------------------------------------
  // AC-22 — Copy command places command text on the clipboard
  // ----------------------------------------------------------------
  it("AC-22: Copy command button writes the command text to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // Two how-to-run steps — each has a copy button (aria-label="Copy command")
    const copyButtons = screen.getAllByRole("button", { name: /Copy command/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);

    // Click the first (step 0: "npm install")
    fireEvent.click(copyButtons[0]!);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("npm install");
  });

  // ----------------------------------------------------------------
  // AC-22 — Share copies the internal onboarding URL
  // ----------------------------------------------------------------
  it("AC-22: Share link button copies window.location.href to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    fireEvent.click(screen.getByRole("button", { name: /Share link/i }));

    expect(writeText).toHaveBeenCalledOnce();
    // The component passes window.location.href — whatever jsdom resolves to
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  // ----------------------------------------------------------------
  // AC-23 — First-task card: no href or navigation handler
  // ----------------------------------------------------------------
  it("AC-23: First-task card renders informational content only — no link or navigation anchor", () => {
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // The <section id="section-first-tasks"> wraps the entire First Tasks card.
    // Nav links live in a separate <nav> outside this section, so within() is a
    // clean scope for the assertion.
    const section = document.getElementById("section-first-tasks");
    expect(section).not.toBeNull();
    expect(within(section!).queryByRole("link")).not.toBeInTheDocument();

    // Task content IS rendered (path/rationale/complexity/gap badges)
    expect(
      screen.getByText("Add missing test for auth module"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The auth module has no test coverage."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Complexity: low/i)).toBeInTheDocument();
    expect(screen.getByText(/Gap: missing_test/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Suggested path: src\/auth\/auth\.test\.ts/i),
    ).toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // First-visit flow — null data → Generate affordance, no auto-POST
  // ----------------------------------------------------------------
  it("first-visit: null data shows the Generate affordance and does NOT auto-POST on mount", () => {
    vi.mocked(useOnboarding).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // Generate affordance is visible
    expect(screen.getByText("No onboarding tour yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Generate tour/i }),
    ).toBeInTheDocument();

    // CRITICAL: no auto-POST on mount — mutate must not have been called
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // First-visit flow — clicking Generate CTA fires POST once
  // ----------------------------------------------------------------
  it("first-visit: clicking Generate tour fires generate.mutate({}) exactly once", () => {
    vi.mocked(useOnboarding).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    fireEvent.click(screen.getByRole("button", { name: /Generate tour/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({});
  });

  // ----------------------------------------------------------------
  // A11y — degraded badge accessible by text + ARIA, not colour-only
  // ----------------------------------------------------------------
  it("a11y: degraded badge is conveyed by visible text and role=status/aria-label, not colour alone", () => {
    vi.mocked(useOnboarding).mockReturnValue({
      data: DEGRADED_ARTIFACT,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // The wrapper has role="status" + aria-label (accessible by screen readers)
    const statusEl = screen.getByRole("status", {
      name: /Index degraded — tour may be incomplete\./i,
    });
    expect(statusEl).toBeInTheDocument();

    // The badge ALSO has visible text content (not communicated by colour alone)
    const badgeText = screen.getAllByText(
      "Index degraded — tour may be incomplete.",
    );
    expect(badgeText.length).toBeGreaterThan(0);
  });
});
