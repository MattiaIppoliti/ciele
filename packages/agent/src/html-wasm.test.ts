import { describe, expect, it } from "vitest";
import { htmlToTextCheerio } from "./extract";
import { extractPageWasm, htmlToTextWasm } from "./html-wasm";
import { extractPageCheerio } from "./local-crawl";

/**
 * The Rust extractor (native/html-extract) must answer what cheerio answers:
 * same title, same text, same links in the same order. Hand-written edge
 * cases first, then generated documents for what nobody thought to write.
 */

const PAGE_URL = "https://example.org/docs/guide/index.html?ref=nav#top";

const CASES: Record<string, string> = {
  plain: "<html><head><title> Hello   world </title></head><body><p>One</p><p>Two</p></body></html>",
  chrome: `<body><header><h1>Site</h1></header><nav><a href="/nav">Nav</a></nav>
    <main><h1>Guide</h1><p>Body <b>text</b>.</p><aside>Aside</aside><a href="/in-main">in main</a></main>
    <footer><a href="/footer">Footer</a></footer></body>`,
  roles: `<body><div role="navigation"><a href="/r1">r1</a></div><div role="banner">B</div>
    <div aria-hidden="true">hidden <a href="/hidden">x</a></div><div role="search"><form><input></form></div>
    <section>Kept <a href="kept">kept</a></section><div role="contentinfo">ci</div></body>`,
  noMain: "<body><div>\n\n\n\n  Lines \t\t here  \n\n\n\n\n and   there </div></body>",
  emptyMain: "<body><main>   \n </main><article>Body wins</article></body>",
  twoMains: "<body><main>First</main><p>between</p><main>Second</main></body>",
  nestedMain: "<body><main>Outer <main>Inner</main></main></body>",
  titleFromH1: "<html><head><title>   </title></head><body><nav><h1>Not this</h1></nav><h1> Real heading </h1><p>x</p></body></html>",
  titleFromUrl: "<body><p>No title anywhere</p></body>",
  svgTitle: "<body><svg><title>Icon</title><text>svg text</text></svg><p>After svg</p></body>",
  template: "<body><template><p>Template text</p><a href='/tpl'>t</a></template><p>Visible</p></body>",
  scripts: "<body><script>var x = 1;</script><style>p{}</style><noscript>enable js</noscript><iframe src='/f'></iframe><p>Content</p></body>",
  whitespace: "<body><p>a  b\r\nc d　e﻿f</p><pre>  keep\n\n\n\n\n  lines  </pre></body>",
  entities: "<body><p>&lt;tag&gt; &amp; &quot;quotes&quot; &copy; &#x1F600; &nbsp;x</p></body>",
  malformed: "<body><p>Unclosed <b>bold <i>italic</p><div>Next<table><tr><td>cell</td></tr></table>",
  emoji: "<title>Emoji 😀 title</title><body><p>Ciao 👋🏽 città · naïve — “quotes”</p></body>",
  empty: "<html><head><title>Only a title</title></head><body>   </body></html>",
  noBody: "<p>Fragment without body</p>",
  links: `<body><main>
    <a href="relative/page">rel</a><a href="../up">up</a><a href="/abs?q=1#frag">abs</a>
    <a href="//cdn.example.org/x">proto-relative</a><a href="mailto:a@b.c">mail</a>
    <a href="javascript:void(0)">js</a><a href="  /spaced  ">spaced</a><a href="">empty</a>
    <a href="/file.PDF">pdf</a><a href="/img.JPEG?x=1">jpeg</a><a href="/page.html">html</a>
    <a href="https://münchen.example/ä?ü=1">idn</a><a href="/a b/c d">space path</a>
    <a href="http://[::1]:8080/v6">ipv6</a><a href="ftp://x.org/f">ftp</a><a href="/archive.tar.gz">gz</a>
    <a href="/x.docx">docx</a><a href="/y.woff2">woff2</a><a href="?only=query">query</a><a href="#only-frag">frag</a>
    <a>no href</a><a href="http://exa mple.org">bad host</a>
  </main></body>`,
};

describe("the Rust HTML extractor matches cheerio", () => {
  for (const [name, html] of Object.entries(CASES)) {
    it(`htmlToText: ${name}`, async () => {
      expect(htmlToTextWasm(html)).toEqual(await htmlToTextCheerio(html));
    });

    it(`extractPage: ${name}`, () => {
      expect(extractPageWasm(html, PAGE_URL)).toEqual(extractPageCheerio(html, PAGE_URL));
    });
  }

  it("matches on generated documents", async () => {
    let seed = 1111;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
    const tags = ["div", "p", "span", "main", "nav", "footer", "header", "aside", "section", "article", "b", "em", "ul", "li", "h1", "h2", "table", "td", "form", "svg", "script", "style", "template", "noscript"];
    const words = ["alpha", "beta", "  ", "\n", "\t", "città", "😀", "&amp;", "&nbsp;", "x y", "\r\n", "<br>", "", "Ünïcode"];
    const hrefs = ["/a", "b/c", "../d", "https://other.org/e", "/f.PDF", "mailto:x@y.z", "#g", "?h=1", " /i ", "/j.png", "//k.org/l"];
    const attrs = ["", ' role="navigation"', ' aria-hidden="true"', ' role="main"', ' aria-hidden="false"', ' role="banner"'];
    const node = (depth: number): string => {
      if (depth > 4 || rand() < 0.3) {
        return rand() < 0.2 ? `<a href="${pick(hrefs)}">${pick(words)}</a>` : pick(words);
      }
      const tag = pick(tags);
      const children = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => node(depth + 1)).join(pick(["", " ", "\n"]));
      return `<${tag}${pick(attrs)}>${children}</${tag}>`;
    };
    for (let i = 0; i < 300; i++) {
      const title = rand() < 0.5 ? `<title>${pick(words)} ${pick(words)}</title>` : "";
      const html = `<html><head>${title}</head><body>${node(0)}${node(0)}</body></html>`;
      expect([i, htmlToTextWasm(html)]).toEqual([i, await htmlToTextCheerio(html)]);
      expect([i, extractPageWasm(html, PAGE_URL)]).toEqual([i, extractPageCheerio(html, PAGE_URL)]);
    }
  });
});
