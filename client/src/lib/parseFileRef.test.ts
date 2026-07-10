import { describe, it, expect } from "vitest";
import { parseFileRef } from "./parseFileRef";

describe("parseFileRef", () => {
  it("parses a bare path with no line", () => {
    expect(parseFileRef("src/api/public.ts")).toEqual({ path: "src/api/public.ts" });
  });

  it("parses a path:line ref", () => {
    expect(parseFileRef("src/mw/ratelimit.ts:12")).toEqual({
      path: "src/mw/ratelimit.ts",
      line: 12,
    });
  });

  it("parses a path:start-end range to its start line", () => {
    expect(parseFileRef("src/mw/ratelimit.ts:12-20")).toEqual({
      path: "src/mw/ratelimit.ts",
      line: 12,
    });
  });

  it("falls back to the whole ref as a bare path when the suffix isn't a line/range", () => {
    expect(parseFileRef("src/api/public.ts:main")).toEqual({
      path: "src/api/public.ts:main",
    });
  });
});
