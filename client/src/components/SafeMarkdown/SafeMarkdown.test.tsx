/* SafeMarkdown — inert-render tests (AC-21).
   Verifies that untrusted content is sanitized: raw HTML stays inert,
   javascript:/data: links are rendered as spans, and safe content renders. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SafeMarkdown } from "./SafeMarkdown";

afterEach(cleanup);

describe("SafeMarkdown", () => {
  it("renders plain markdown text", () => {
    render(<SafeMarkdown content="Hello **world**" />);
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders a safe https link as an anchor", () => {
    render(<SafeMarkdown content="See [the docs](https://example.com)" />);
    const link = screen.getByRole("link", { name: /the docs/i });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a javascript: href as an inert span, not an anchor (AC-21)", () => {
    render(<SafeMarkdown content="[click me](javascript:alert('xss'))" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("renders a data: href as an inert span, not an anchor (AC-21)", () => {
    render(<SafeMarkdown content="[img](data:text/html,<script>alert(1)</script>)" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("img")).toBeInTheDocument();
  });

  it("renders raw <script> tags as inert text, not executed (no rehype-raw)", () => {
    render(<SafeMarkdown content={"Before\n<script>window.__xss = true</script>\nAfter"} />);
    // The script element must not be in the DOM as a script element
    expect(document.querySelector("script")).toBeNull();
    // Content before and after the script block should render
    expect(screen.getByText(/Before/)).toBeInTheDocument();
    expect(screen.getByText(/After/)).toBeInTheDocument();
  });

  it("renders inline code and fenced code blocks without executing them", () => {
    const content = "Use `const x = 1` inline.\n\n```js\nconsole.log('block')\n```";
    render(<SafeMarkdown content={content} />);
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
    expect(screen.getByText(/console\.log/)).toBeInTheDocument();
  });
});
