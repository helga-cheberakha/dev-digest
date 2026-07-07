import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DiscoveredDocument } from "@devdigest/shared";
import messages from "../../../../messages/en/project-context.json";

// ---- Mock: AppShell renders children as-is (shell uses global hooks not needed here) ----
vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---- Mock: project-context hooks ----
vi.mock("../../../lib/hooks/project-context", () => ({
  useDiscoveredDocuments: vi.fn(),
  useDocumentPreview: vi.fn(),
  useAgentDocuments: vi.fn(),
  useSetAgentDocuments: vi.fn(),
  useSkillDocuments: vi.fn(),
  useSetSkillDocuments: vi.fn(),
}));

// ---- Mock: agents hook ----
vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: vi.fn(),
}));

// ---- Mock: skills hook ----
vi.mock("../../../lib/hooks/skills", () => ({
  useSkills: vi.fn(),
}));

// ---- Mock: repo-context ----
vi.mock("../../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));

// Import mocked modules for type-safe mockReturnValue
import {
  useDiscoveredDocuments,
  useDocumentPreview,
  useAgentDocuments,
  useSetAgentDocuments,
  useSkillDocuments,
  useSetSkillDocuments,
} from "../../../lib/hooks/project-context";
import { useAgents } from "../../../lib/hooks/agents";
import { useSkills } from "../../../lib/hooks/skills";
import { useActiveRepo } from "../../../lib/repo-context";

import { ProjectContextView } from "./ProjectContextView";

afterEach(cleanup);

// ---- Fixtures ----

const DOCS: DiscoveredDocument[] = [
  {
    path: "specs/api-contract.md",
    parent_path: "specs",
    name: "api-contract.md",
    folder_kind: "specs",
    size_bytes: 1024,
    est_tokens: 256,
    used_by_agents: 2,
  },
  {
    path: "docs/architecture.md",
    parent_path: "docs",
    name: "architecture.md",
    folder_kind: "docs",
    size_bytes: 2048,
    est_tokens: 512,
    used_by_agents: 0,
  },
  {
    path: "insights/performance.md",
    parent_path: "insights",
    name: "performance.md",
    folder_kind: "insights",
    size_bytes: 512,
    est_tokens: 128,
    used_by_agents: 1,
  },
];

const XSS_DOC: DiscoveredDocument = {
  path: "specs/evil.md",
  parent_path: "specs",
  name: "evil.md",
  folder_kind: "specs",
  size_bytes: 200,
  est_tokens: 50,
  used_by_agents: 0,
};

const AGENT = { id: "ag1", name: "Security Reviewer" };
const SKILL = { id: "sk1", name: "TypeScript Linter" };

// ---- Helper ----

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ "project-context": messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---- Default mock setup ----

function setDefaultMocks() {
  vi.mocked(useActiveRepo).mockReturnValue({ repoId: "repo1" } as any);
  vi.mocked(useDiscoveredDocuments).mockReturnValue({
    data: { documents: DOCS, truncated: false },
    isLoading: false,
    isError: false,
  } as any);
  vi.mocked(useDocumentPreview).mockReturnValue({
    data: { path: "specs/api-contract.md", content: "# API Contract\n\nVersion 1.0" },
    isLoading: false,
  } as any);
  vi.mocked(useAgents).mockReturnValue({ data: [AGENT] } as any);
  vi.mocked(useSkills).mockReturnValue({ data: [SKILL] } as any);
  vi.mocked(useAgentDocuments).mockReturnValue({ data: { paths: [] }, isLoading: false } as any);
  vi.mocked(useSetAgentDocuments).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  vi.mocked(useSkillDocuments).mockReturnValue({ data: { paths: [] }, isLoading: false } as any);
  vi.mocked(useSetSkillDocuments).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
}

// ---- Tests ----

describe("ProjectContextView", () => {
  beforeEach(setDefaultMocks);

  it("renders document list with folder-kind badges and per-row token counts", () => {
    renderWithIntl(<ProjectContextView />);

    // Documents appear in left pane
    expect(screen.getByText("api-contract.md")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("performance.md")).toBeInTheDocument();

    // Folder-kind badges (use getAllByText — badge text and parent_path may coincide)
    expect(screen.getAllByText("specs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("docs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("insights").length).toBeGreaterThan(0);

    // Per-row token counts (AC-26) — only those in the left pane rows
    expect(screen.getByText("≈ 256 tokens")).toBeInTheDocument();
    expect(screen.getByText("≈ 512 tokens")).toBeInTheDocument();
    expect(screen.getByText("≈ 128 tokens")).toBeInTheDocument();

    // Filter input is present
    expect(screen.getByLabelText("Filter documents…")).toBeInTheDocument();
  });

  it("filters the document list as the user types", () => {
    renderWithIntl(<ProjectContextView />);

    const filterInput = screen.getByLabelText("Filter documents…");
    fireEvent.change(filterInput, { target: { value: "arch" } });

    // Only "architecture.md" matches
    expect(screen.queryByText("api-contract.md")).not.toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.queryByText("performance.md")).not.toBeInTheDocument();
  });

  it("shows document details (name, used-by-agents badge, token figure) when a doc is selected", () => {
    renderWithIntl(<ProjectContextView />);

    // Click the first document to select it
    fireEvent.click(screen.getByText("api-contract.md"));

    // Right pane: document name (as heading)
    const headings = screen.getAllByText("api-contract.md");
    expect(headings.length).toBeGreaterThan(1); // left pane row + right pane heading

    // "used by N agents" badge — 2 agents for this doc
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();

    // Right-pane token figure (≈ 256 tokens from est_tokens)
    // There will be multiple "≈ 256 tokens" instances (row + detail pane)
    expect(screen.getAllByText("≈ 256 tokens").length).toBeGreaterThan(1);

    // Preview heading
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("shows 'Not attached to any agent' when used_by_agents is 0", () => {
    renderWithIntl(<ProjectContextView />);

    // Click architecture.md which has used_by_agents: 0
    fireEvent.click(screen.getByText("architecture.md"));

    expect(screen.getByText("Not attached to any agent")).toBeInTheDocument();
  });

  it("toggling an agent checkbox calls setAgentDocuments with the doc path appended", () => {
    const mockMutate = vi.fn();
    vi.mocked(useSetAgentDocuments).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
    vi.mocked(useAgentDocuments).mockReturnValue({ data: { paths: [] }, isLoading: false } as any);

    renderWithIntl(<ProjectContextView />);

    // Select a document
    fireEvent.click(screen.getByText("api-contract.md"));

    // Attach control shows the agent
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();

    // Find the checkbox for the agent and click it
    const checkbox = screen.getByRole("checkbox", {
      name: "Attach to Security Reviewer",
    });
    fireEvent.click(checkbox);

    // The set-hook should be called with the doc path appended (including repoId for determinism)
    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/api-contract.md"],
      repoId: "repo1",
    });
  });

  it("detaches a doc by unchecking an already-checked agent checkbox", () => {
    const mockMutate = vi.fn();
    vi.mocked(useSetAgentDocuments).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
    // The agent already has the doc attached
    vi.mocked(useAgentDocuments).mockReturnValue({
      data: { paths: ["specs/api-contract.md"] },
      isLoading: false,
    } as any);

    renderWithIntl(<ProjectContextView />);
    fireEvent.click(screen.getByText("api-contract.md"));

    const checkbox = screen.getByRole("checkbox", {
      name: "Detach from Security Reviewer",
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({ agentId: "ag1", paths: [], repoId: "repo1" });
  });

  it("renders xss-inert preview: <script> tag is inert, javascript: link has no href", () => {
    const xssContent =
      "<script>window.__xss = true;</script>\n\n[click me](javascript:window.__xss=true)";

    vi.mocked(useDiscoveredDocuments).mockReturnValue({
      data: { documents: [XSS_DOC], truncated: false },
      isLoading: false,
      isError: false,
    } as any);
    vi.mocked(useDocumentPreview).mockReturnValue({
      data: { path: XSS_DOC.path, content: xssContent },
      isLoading: false,
    } as any);

    renderWithIntl(<ProjectContextView />);
    fireEvent.click(screen.getByText("evil.md"));

    // No <script> element was injected into the DOM
    expect(document.querySelectorAll("script")).toHaveLength(0);

    // No anchor with javascript: href (link is rendered as inert span)
    expect(document.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);

    // The link text still renders as text (click me)
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("shows empty state when discovery returns no documents (AC-3)", () => {
    vi.mocked(useDiscoveredDocuments).mockReturnValue({
      data: { documents: [], truncated: false, reason: "No matching files found" },
      isLoading: false,
      isError: false,
    } as any);

    renderWithIntl(<ProjectContextView />);

    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(screen.getByText(/No markdown files were discovered/i)).toBeInTheDocument();

    // No doc rows in the left pane
    expect(screen.queryByText("api-contract.md")).not.toBeInTheDocument();
  });

  it("shows no-selection prompt in right pane when nothing is selected", () => {
    renderWithIntl(<ProjectContextView />);

    // Before any selection
    expect(
      screen.getByText("Select a document from the list to preview it."),
    ).toBeInTheDocument();
  });
});
