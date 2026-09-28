import { describe, expect, it } from "vitest";
import { applyMarkdownCommand } from "./markdown-toolbar";

describe("applyMarkdownCommand", () => {
  it("wraps the selection with the same marker on both sides", () => {
    expect(applyMarkdownCommand("say hello now", 4, 9, { wrap: "**" })).toBe(
      "say **hello** now"
    );
  });

  it("wraps with a distinct closing marker", () => {
    expect(applyMarkdownCommand("docs", 0, 4, { wrap: "[", wrapEnd: "](url)" })).toBe(
      "[docs](url)"
    );
  });

  it("inserts an empty pair at a collapsed caret", () => {
    expect(applyMarkdownCommand("ab", 1, 1, { wrap: "`" })).toBe("a``b");
  });

  it("prefixes the line the selection starts on", () => {
    expect(applyMarkdownCommand("one\ntwo\nthree", 6, 10, { prefix: "# " })).toBe(
      "one\n# two\nthree"
    );
  });

  it("prefixes the first line when the caret is at the start", () => {
    expect(applyMarkdownCommand("title", 0, 0, { prefix: "- " })).toBe("- title");
  });

  it("rewrites only the selection with a transform", () => {
    const upper = { transform: (s: string) => s.toUpperCase() };
    expect(applyMarkdownCommand("a bc d", 2, 4, upper)).toBe("a BC d");
  });
});
