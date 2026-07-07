/* ContextTab tests — AC-20, AC-22, AC-23, AC-27
   AC-27: Preview opens a dismissible Drawer with filename, parent path, and SafeMarkdown body.
   Tests use fireEvent (not @testing-library/user-event which is absent from this package). */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import skillsMessages from "../../../../../../../../messages/en/skills.json";

// Mock the data hooks — component must render without a network/query client.
vi.mock("../../../../../../../lib/hooks/project-context", () => ({
  useSkillDocuments: vi.fn(),
  useSetSkillDocuments: vi.fn(),
  useDiscoveredDocuments: vi.fn(),
  useDocumentPreview: vi.fn(),
}));

vi.mock("../../../../../../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));

import {
  useSkillDocuments,
  useSetSkillDocuments,
  useDiscoveredDocuments,
  useDocumentPreview,
} from "../../../../../../../lib/hooks/project-context";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import { ContextTab } from "./ContextTab";

afterEach(cleanup);

// ---- Fixtures ----

const DISCOVERED_DOCS = [
  {
    path: "specs/public-api.md",
    parent_path: "specs",
    name: "public-api.md",
    folder_kind: "specs" as const,
    size_bytes: 4000,
    est_tokens: 100,
    used_by_agents: 0,
  },
  {
    path: "docs/onboarding.md",
    parent_path: "docs",
    name: "onboarding.md",
    folder_kind: "docs" as const,
    size_bytes: 2000,
    est_tokens: 50,
    used_by_agents: 1,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---- Shared mock setup ----

function setupDefaultMocks() {
  vi.mocked(useActiveRepo).mockReturnValue({
    repoId: "repo1",
    setRepoId: vi.fn(),
    repos: [],
    activeRepo: null,
    reposLoaded: true,
  });
  vi.mocked(useDiscoveredDocuments).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { documents: DISCOVERED_DOCS, truncated: false },
  } as ReturnType<typeof useDiscoveredDocuments>);
  vi.mocked(useSkillDocuments).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { paths: ["specs/public-api.md"] },
  } as ReturnType<typeof useSkillDocuments>);
  vi.mocked(useSetSkillDocuments).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSetSkillDocuments>);
  vi.mocked(useDocumentPreview).mockReturnValue({
    isLoading: false,
    isError: false,
    data: undefined,
  } as ReturnType<typeof useDocumentPreview>);
}

// ---- Tests: existing AC-22/AC-23 coverage (preserved) ----

describe("ContextTab (skill editor)", () => {
  beforeEach(setupDefaultMocks);

  it("renders the SERIALIZES AS block with the attached path under ## Project context (AC-23)", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    // The SERIALIZES AS heading must be visible.
    expect(screen.getByText(/SERIALIZES AS/i)).toBeInTheDocument();

    // The pre block must contain the Markdown heading and the attached path.
    const serializesBlock = screen.getByTestId("serializes-as-block");
    expect(serializesBlock).toHaveTextContent("## Project context");
    expect(serializesBlock).toHaveTextContent("- specs/public-api.md");
  });

  it("SERIALIZES AS updates live when an attachment is toggled off (AC-23)", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    // Initially the block shows the attached path.
    expect(screen.getByTestId("serializes-as-block")).toHaveTextContent("- specs/public-api.md");

    // Uncheck the attached document — its checkbox is labelled "Detach public-api.md".
    const detachCheckbox = screen.getByRole("checkbox", { name: /Detach public-api\.md/i });
    fireEvent.click(detachCheckbox);

    // After detach, no path remains in the selection → SERIALIZES AS block disappears.
    expect(screen.queryByTestId("serializes-as-block")).not.toBeInTheDocument();
  });

  it("SERIALIZES AS updates live when an unattached doc is attached (AC-23)", () => {
    vi.mocked(useSkillDocuments).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { paths: [] as string[] },
    } as unknown as ReturnType<typeof useSkillDocuments>);

    renderWithIntl(<ContextTab skillId="skill1" />);

    // No SERIALIZES AS block when nothing is attached.
    expect(screen.queryByTestId("serializes-as-block")).not.toBeInTheDocument();

    // Attach docs/onboarding.md — checkbox is labelled "Attach onboarding.md".
    const attachCheckbox = screen.getByRole("checkbox", { name: /Attach onboarding\.md/i });
    fireEvent.click(attachCheckbox);

    // Block now appears with the newly attached path.
    const serializesBlock = screen.getByTestId("serializes-as-block");
    expect(serializesBlock).toHaveTextContent("## Project context");
    expect(serializesBlock).toHaveTextContent("- docs/onboarding.md");
  });

  it("shows token total and untrusted note (AC-22)", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    // Token total: specs/public-api.md has est_tokens = 100.
    expect(screen.getByText(/100.*tokens attached/)).toBeInTheDocument();

    // Untrusted note text is present.
    expect(
      screen.getByText(/injected as an untrusted.*Project context/i),
    ).toBeInTheDocument();
  });

  it("shows a filter input and filters the document list", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    // Both docs should be visible.
    expect(screen.getByText("public-api.md")).toBeInTheDocument();
    expect(screen.getByText("onboarding.md")).toBeInTheDocument();

    // Filter to "onboarding".
    const filterInput = screen.getByRole("textbox", { name: /filter documents/i });
    fireEvent.change(filterInput, { target: { value: "onboarding" } });

    // The attached doc is filtered away (it doesn't match "onboarding").
    expect(screen.queryByText("public-api.md")).not.toBeInTheDocument();
    expect(screen.getByText("onboarding.md")).toBeInTheDocument();
  });

  it("drag-reorder while a filter is active persists the correct full order", () => {
    // Regression: drag indices must address the UNFILTERED orderedPaths array.
    // With three attached docs [alpha, beta, gamma] and a filter hiding beta,
    // dragging gamma onto alpha must produce [gamma, alpha, beta] — not move
    // the hidden beta (which is what filtered-list indices would do).
    const threeDocs = [
      { ...DISCOVERED_DOCS[0], path: "specs/alpha-spec.md", name: "alpha-spec.md" },
      { ...DISCOVERED_DOCS[1], path: "docs/beta-doc.md", name: "beta-doc.md" },
      { ...DISCOVERED_DOCS[0], path: "specs/gamma-spec.md", name: "gamma-spec.md" },
    ];
    vi.mocked(useDiscoveredDocuments).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { documents: threeDocs, truncated: false },
    } as ReturnType<typeof useDiscoveredDocuments>);
    vi.mocked(useSkillDocuments).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { paths: ["specs/alpha-spec.md", "docs/beta-doc.md", "specs/gamma-spec.md"] },
    } as unknown as ReturnType<typeof useSkillDocuments>);
    const mutate = vi.fn();
    vi.mocked(useSetSkillDocuments).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useSetSkillDocuments>);

    renderWithIntl(<ContextTab skillId="skill1" />);

    // Filter to "spec" — hides beta-doc.md, leaves alpha and gamma visible.
    const filterInput = screen.getByRole("textbox", { name: /filter documents/i });
    fireEvent.change(filterInput, { target: { value: "spec" } });
    expect(screen.queryByText("beta-doc.md")).not.toBeInTheDocument();

    const rowOf = (name: RegExp) =>
      screen.getByRole("checkbox", { name })!.closest('[draggable="true"]')!;
    const gammaRow = rowOf(/Detach gamma-spec\.md/i);
    const alphaRow = rowOf(/Detach alpha-spec\.md/i);

    fireEvent.dragStart(gammaRow);
    fireEvent.dragEnter(alphaRow);
    fireEvent.dragEnd(gammaRow);

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        paths: ["specs/gamma-spec.md", "specs/alpha-spec.md", "docs/beta-doc.md"],
      }),
    );
  });
});

// ---- Tests: AC-27 Preview drawer ----

describe("ContextTab drawer (AC-27)", () => {
  beforeEach(() => {
    setupDefaultMocks();
    // Override preview hook to return markdown content for drawer tests.
    vi.mocked(useDocumentPreview).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { path: "specs/public-api.md", content: "# API Overview\n\nSome content here." },
    } as ReturnType<typeof useDocumentPreview>);
  });

  it("clicking Preview opens a drawer with the document filename as title and renders SafeMarkdown body", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    // Preview button for the attached doc
    const previewBtn = screen.getByRole("button", { name: /preview public-api\.md/i });
    fireEvent.click(previewBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Drawer title shows filename
    expect(within(dialog).getByText("public-api.md")).toBeInTheDocument();
    // SafeMarkdown renders the heading as an <h1>
    expect(within(dialog).getByRole("heading", { name: /api overview/i })).toBeInTheDocument();
  });

  it("drawer subtitle shows the document parent path", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    fireEvent.click(screen.getByRole("button", { name: /preview public-api\.md/i }));

    const dialog = screen.getByRole("dialog");
    // "specs" appears in subtitle (and optionally footer badge) — at least one occurrence
    expect(within(dialog).getAllByText("specs").length).toBeGreaterThan(0);
  });

  it("XSS content in preview renders inert — script stripped, javascript: link is not an anchor (AC-21)", () => {
    vi.mocked(useDocumentPreview).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        path: "specs/public-api.md",
        content:
          "<script>alert('xss')</script>\n\n[click me](javascript:alert(1))",
      },
    } as ReturnType<typeof useDocumentPreview>);

    renderWithIntl(<ContextTab skillId="skill1" />);

    fireEvent.click(screen.getByRole("button", { name: /preview public-api\.md/i }));

    const dialog = screen.getByRole("dialog");
    // No <script> element inside the drawer
    expect(dialog.querySelector("script")).toBeNull();
    // The javascript: link must NOT render as a real anchor (<a>) — SafeMarkdown replaces with <span>
    expect(within(dialog).queryByRole("link", { name: /click me/i })).not.toBeInTheDocument();
  });

  it("clicking Preview on a different row switches the drawer to that document", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    // Open drawer for public-api.md (attached doc)
    fireEvent.click(screen.getByRole("button", { name: /preview public-api\.md/i }));
    expect(within(screen.getByRole("dialog")).getByText("public-api.md")).toBeInTheDocument();

    // Switch to onboarding.md (unattached doc)
    fireEvent.click(screen.getByRole("button", { name: /preview onboarding\.md/i }));

    // Drawer stays open, title changes to onboarding.md
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("onboarding.md")).toBeInTheDocument();
  });

  it("close button hides the drawer", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    fireEvent.click(screen.getByRole("button", { name: /preview public-api\.md/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Drawer's IconBtn renders with aria-label="Close"
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("re-clicking the same Preview button dismisses the drawer", () => {
    renderWithIntl(<ContextTab skillId="skill1" />);

    const previewBtn = screen.getByRole("button", { name: /preview public-api\.md/i });
    fireEvent.click(previewBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Second click on the same row toggles the preview off
    fireEvent.click(previewBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
