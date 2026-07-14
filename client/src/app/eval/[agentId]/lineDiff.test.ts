import { describe, it, expect } from "vitest";
import { highlightAdditions } from "./lineDiff";

describe("highlightAdditions", () => {
  it("marks nothing as added when old and new are identical", () => {
    const text = "line one\nline two\nline three";
    expect(highlightAdditions(text, text).every((l) => !l.added)).toBe(true);
  });

  it("marks only the genuinely new line as added, preserving unchanged lines", () => {
    const oldText = "You are a reviewer.\nReturn at most 5 findings.";
    const newText = "You are a reviewer.\nFlag unused imports.\nReturn at most 5 findings.";

    const result = highlightAdditions(oldText, newText);

    expect(result).toEqual([
      { text: "You are a reviewer.", added: false },
      { text: "Flag unused imports.", added: true },
      { text: "Return at most 5 findings.", added: false },
    ]);
  });

  it("marks every line as added when old text is empty", () => {
    const result = highlightAdditions("", "a\nb");
    // "" split by "\n" is [""], so the empty old line still counts as "present" —
    // only lines that are genuinely absent from old are added.
    expect(result).toEqual([
      { text: "a", added: true },
      { text: "b", added: true },
    ]);
  });
});
