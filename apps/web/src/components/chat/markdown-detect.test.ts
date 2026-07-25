import { describe, expect, it } from "vitest";
import { hasMarkdownSyntax } from "./markdown-detect";

/**
 * Plain text must stay false — that is what keeps the react-markdown chunk
 * off the widget's initial load — while anything that could render richly
 * must stay true.
 */

describe("hasMarkdownSyntax", () => {
  it("is false for plain text, so the widget skips the markdown chunk", () => {
    expect(hasMarkdownSyntax("Hi! How can I help you today?")).toBe(false);
    expect(
      hasMarkdownSyntax("Benvenuto. Chiedimi qualsiasi cosa sui corsi.")
    ).toBe(false);
    expect(hasMarkdownSyntax("Office hours: Mon-Fri, 9:00 to 17:00.")).toBe(
      false
    );
  });

  it("detects inline formatting", () => {
    expect(hasMarkdownSyntax("**grassetto** e *corsivo*")).toBe(true);
    expect(hasMarkdownSyntax("some `code`")).toBe(true);
    expect(hasMarkdownSyntax("[Ateneo](https://www.esempio-ateneo.it)")).toBe(
      true
    );
  });

  it("detects block syntax", () => {
    expect(hasMarkdownSyntax("# Ammissione")).toBe(true);
    expect(hasMarkdownSyntax("- Test di ingresso\n- Colloquio")).toBe(true);
    expect(hasMarkdownSyntax("1. Iscrizione")).toBe(true);
    expect(hasMarkdownSyntax("| A | B |\n| - | - |")).toBe(true);
  });

  it("detects bare URLs and raw HTML", () => {
    expect(
      hasMarkdownSyntax("Visit https://www.esempio-ateneo.it for details")
    ).toBe(true);
    expect(hasMarkdownSyntax('<script>alert("x")</script>')).toBe(true);
  });
});
