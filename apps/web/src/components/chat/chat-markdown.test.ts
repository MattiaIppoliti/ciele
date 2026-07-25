import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "./chat-markdown";

/**
 * The chat surfaces (Widget, Preview, Inbox) must actually render assistant
 * markdown — bold/italic/links/lists were previously shown as raw asterisks.
 */

const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("ChatMarkdown", () => {
  it("renders bold, italic and inline code", () => {
    const html = render("**grassetto** e *corsivo* e `codice`");
    expect(html).toContain("<strong");
    expect(html).toContain("grassetto");
    expect(html).toContain("<em");
    expect(html).toContain("corsivo");
    expect(html).toContain("<code");
  });

  it("renders links that open in a new tab", () => {
    const html = render("[Ateneo](https://www.esempio-ateneo.it)");
    expect(html).toContain('href="https://www.esempio-ateneo.it"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders headings and lists", () => {
    const html = render("# Ammissione\n\n- Test di ingresso\n- Colloquio\n\n1. Iscrizione");
    expect(html).toContain("<h1");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
  });

  it("renders GFM tables", () => {
    const html = render("| A | B |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<td");
  });

  it("does not render raw HTML from the model", () => {
    const html = render('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
  });
});
