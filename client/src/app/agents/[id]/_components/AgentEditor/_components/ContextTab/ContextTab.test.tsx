/* ContextTab RTL tests — AC-20, AC-22
   Tests: lists documents, filters, toggles attach, reorders via drag,
   shows token total + untrusted note, and renders when ?tab=context. */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

// ── Mock project-context hooks ──────────────────────────────────────────────
const mockMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/project-context", () => ({
  useAgentDocuments: vi.fn(),
  useSetAgentDocuments: vi.fn(),
  useDiscoveredDocuments: vi.fn(),
  useDocumentPreview: vi.fn(),
}));

// ── Mock repo-context ────────────────────────────────────────────────────────
vi.mock("../../../../../../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));

// ── Mock AgentEditor's hooks (for integration smoke test) ────────────────────
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [] }),
}));

// ── Mock hooks/skills so SkillsTab doesn't crash ─────────────────────────────
vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false }),
  useAgentSkillLinks: () => ({ data: [], isLoading: false }),
  useSetAgentSkills: () => ({ mutate: vi.fn() }),
}));

import { ContextTab } from "./ContextTab";
import { AgentEditor } from "../../AgentEditor";
import * as projectContextHooks from "../../../../../../../lib/hooks/project-context";
import * as repoContextModule from "../../../../../../../lib/repo-context";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DOCS = [
  {
    path: "specs/api.md",
    name: "api.md",
    parent_path: "specs",
    folder_kind: "specs" as const,
    size_bytes: 2000,
    est_tokens: 500,
    used_by_agents: 1,
  },
  {
    path: "docs/guide.md",
    name: "guide.md",
    parent_path: "docs",
    folder_kind: "docs" as const,
    size_bytes: 4000,
    est_tokens: 1000,
    used_by_agents: 0,
  },
  {
    path: "insights/notes.md",
    name: "notes.md",
    parent_path: "insights",
    folder_kind: "insights" as const,
    size_bytes: 800,
    est_tokens: 200,
    used_by_agents: 0,
  },
];

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  vi.mocked(repoContextModule.useActiveRepo).mockReturnValue({
    repoId: "repo1",
    setRepoId: vi.fn(),
    repos: [],
    activeRepo: null,
    reposLoaded: true,
  });

  vi.mocked(projectContextHooks.useAgentDocuments).mockReturnValue({
    data: { paths: ["specs/api.md", "docs/guide.md"] },
    isLoading: false,
  } as ReturnType<typeof projectContextHooks.useAgentDocuments>);

  vi.mocked(projectContextHooks.useDiscoveredDocuments).mockReturnValue({
    data: { documents: DOCS, truncated: false },
    isLoading: false,
  } as ReturnType<typeof projectContextHooks.useDiscoveredDocuments>);

  vi.mocked(projectContextHooks.useSetAgentDocuments).mockReturnValue({
    mutate: mockMutate,
  } as unknown as ReturnType<typeof projectContextHooks.useSetAgentDocuments>);

  vi.mocked(projectContextHooks.useDocumentPreview).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof projectContextHooks.useDocumentPreview>);
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ContextTab (AC-20, AC-22)", () => {
  beforeEach(setupDefaultMocks);

  it("lists candidate documents with checkbox, filename, parent path, folder-kind badge, and Preview button", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    // All 3 docs rendered
    expect(screen.getByText("api.md")).toBeInTheDocument();
    expect(screen.getByText("guide.md")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();

    // Parent paths and folder-kind badges displayed (text appears in both path span + badge)
    expect(screen.getAllByText("specs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("docs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("insights").length).toBeGreaterThan(0);

    // Preview buttons present (one per doc)
    const previewBtns = screen.getAllByText("Preview");
    expect(previewBtns).toHaveLength(3);

    // Drag handles for attached rows (2 attached)
    const dragHandles = screen.getAllByText("⠿");
    expect(dragHandles).toHaveLength(2);

    // 2 checked, 1 unchecked
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.filter((cb) => (cb as HTMLInputElement).checked)).toHaveLength(2);
    expect(checkboxes.filter((cb) => !(cb as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("filters documents by search input", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    const filter = screen.getByPlaceholderText("Filter documents…");
    fireEvent.change(filter, { target: { value: "api" } });

    // Only api.md in unattached section would be filtered; attached rows always show
    // api.md is attached — it shows in the attached section (always visible)
    expect(screen.getByText("api.md")).toBeInTheDocument();
    // notes.md is unattached and doesn't match "api" — should be hidden
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();
  });

  it("toggling an unattached checkbox attaches the doc and calls setDocuments", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    const checkboxes = screen.getAllByRole("checkbox");
    const unchecked = checkboxes.find((cb) => !(cb as HTMLInputElement).checked)!;
    expect(unchecked).toBeTruthy();

    fireEvent.click(unchecked);

    expect(mockMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/api.md", "docs/guide.md", "insights/notes.md"],
    });
  });

  it("toggling an attached checkbox detaches the doc and calls setDocuments", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    const checkboxes = screen.getAllByRole("checkbox");
    const firstChecked = checkboxes.find((cb) => (cb as HTMLInputElement).checked)!;
    fireEvent.click(firstChecked);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "ag1" }),
    );
    const call = mockMutate.mock.calls[0]![0] as { paths: string[] };
    expect(call.paths).toHaveLength(1);
  });

  it("reorders attached docs via drag-and-drop and calls setDocuments", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    const dragHandles = screen.getAllByText("⠿");
    expect(dragHandles).toHaveLength(2);

    const row0 = dragHandles[0]!.parentElement!;
    const row1 = dragHandles[1]!.parentElement!;

    fireEvent.dragStart(row0);
    fireEvent.dragEnter(row1);
    fireEvent.dragEnd(row0);

    expect(mockMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["docs/guide.md", "specs/api.md"],
    });
  });

  it("shows the estimated token total for the current selection (AC-22)", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    // api.md (500) + guide.md (1000) = 1500 tokens
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getByText(/tokens selected/)).toBeInTheDocument();
  });

  it("shows the untrusted ## Project context note in the footer (AC-22)", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);

    expect(screen.getByText(/untrusted/i)).toBeInTheDocument();
    expect(screen.getByText(/Project context/i)).toBeInTheDocument();
  });

  it("shows a preview panel when Preview is clicked", () => {
    vi.mocked(projectContextHooks.useDocumentPreview).mockReturnValue({
      data: { path: "specs/api.md", content: "# API spec" },
      isLoading: false,
    } as ReturnType<typeof projectContextHooks.useDocumentPreview>);

    renderWithIntl(<ContextTab agentId="ag1" />);

    const previewBtns = screen.getAllByText("Preview");
    fireEvent.click(previewBtns[0]!);

    expect(screen.getByText("# API spec")).toBeInTheDocument();
  });
});

describe("AgentEditor renders ContextTab on ?tab=context", () => {
  beforeEach(setupDefaultMocks);

  it("renders the Context tab content when tab prop is 'context'", () => {
    renderWithIntl(
      <AgentEditor agent={AGENT} tab="context" onTab={() => {}} />,
    );

    // Tab bar shows "Context"
    expect(screen.getByText("Context")).toBeInTheDocument();
    // ContextTab content renders (filter placeholder visible)
    expect(screen.getByPlaceholderText("Filter documents…")).toBeInTheDocument();
  });
});
