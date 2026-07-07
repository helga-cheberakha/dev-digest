import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

// ---- Tests ----

describe("ContextTab (skill editor)", () => {
  beforeEach(() => {
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
  });

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
});
