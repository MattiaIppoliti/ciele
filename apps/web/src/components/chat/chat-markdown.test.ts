import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "./chat-markdown";
import type { CitationItem } from "@/components/agents/citations";
import AICitation from "@/components/smoothui/ai-citation";

/**
 * The chat surfaces (Widget, Preview, Inbox) must actually render assistant
 * markdown, bold/italic/links/lists were previously shown as raw asterisks.
 */

const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("ChatMarkdown", () => {
  const citations: CitationItem[] = [
    {
      id: "admissions",
      title: "Admissions",
      domain: "University · Application guide",
      url: "https://example.edu/apply",
    },
    {
      id: "handbook",
      title: "Private handbook",
      domain: "University · handbook.pdf",
    },
  ];
  const cited = (
    text: string,
    inlineSources = citations,
  ) =>
    renderToStaticMarkup(
      createElement(ChatMarkdown, {
        text,
        inlineSources,
        renderCitation: (citation, index) =>
          createElement(AICitation, {
            label: index + 1,
            title: citation.title,
            description: citation.domain,
            url: citation.url,
          }),
      }),
    );

  it("places source previews inline without replacing the source link's wording", () => {
    const html = cited(
      "Read the [application guide](https://example.edu/apply).",
    );
    expect(html).toContain("application guide");
    expect(html).toContain('data-slot="ai-citation"');
    expect(html).toContain('aria-label="Source 1: Admissions"');
    expect(html).toContain('href="https://example.edu/apply"');
    expect(html).not.toContain("Source 2");
  });

  it("places private source citations at each referenced step by identity", () => {
    const html = cited(
      "1. Enter your email [2](#ciele-source-handbook).\n2. Enter your password [2](#ciele-source-handbook).",
    );
    expect(html.match(/Source 2: Private handbook/g)).toHaveLength(2);
    expect(html).toMatch(/email[\s\S]*ai-citation[\s\S]*<\/li>/);
    expect(html).not.toContain("Source 1: Admissions");
    expect(html).not.toContain('href="#ciele-source-');
  });

  it("does not attach unreferenced sources to the final paragraph", () => {
    const html = cited("Apply by Friday.");
    expect(html).not.toContain("ai-citation");
  });

  it("does not bind unknown source IDs or move citations when sources are reordered", () => {
    const html = cited(
      "Enter your email [2](#ciele-source-handbook). [3](#ciele-source-unknown)",
      [...citations].reverse(),
    );
    expect(html).toContain('aria-label="Source 1: Private handbook"');
    expect(html).not.toContain("Source 2: Admissions");
    expect(html).toContain('href="#ciele-source-unknown"');
  });

  it("renders a numbered source link as a single pill", () => {
    const html = cited(
      "Applications are open [1](https://example.edu/apply).",
    );
    expect(html).not.toContain("open 1");
    expect(html.match(/Source 1: Admissions/g)).toHaveLength(1);
  });

  it("leaves code, unrelated links and unbound numeric markers unchanged", () => {
    const html = cited(
      "`[guide](https://example.edu/apply)` [1] [other](https://other.edu).",
    );
    expect(html).not.toContain("ai-citation");
    expect(html).toContain("[guide](https://example.edu/apply)");
    expect(html).toContain("[1]");
    expect(html).toContain('href="https://other.edu"');
  });

  it("cannot turn an unsafe source URL into a clickable link", () => {
    const html = cited("An answer [1](#ciele-source-bad).", [
      { id: "bad", title: "Unsafe", url: "javascript:alert(1)" },
    ]);
    expect(html).toContain("<button");
    expect(html).not.toContain('href="javascript:');
  });

  it("keeps citations out of responses that do not opt in", () => {
    const html = render("Read [the guide](https://example.edu/apply).");
    expect(html).not.toContain("ai-citation");
    expect(html).toContain('href="https://example.edu/apply"');
  });

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
    const html = render(
      "# Ammissione\n\n- Test di ingresso\n- Colloquio\n\n1. Iscrizione",
    );
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
