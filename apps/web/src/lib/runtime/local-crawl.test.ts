import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPage, globToRegExp, localCrawl } from "./local-crawl";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("./pinned-fetch", () => ({ fetchPinnedPage: vi.fn() }));

import { fetchPinnedPage } from "./pinned-fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * The built-in (no-Apify) crawler's pure parts: HTML → page text + links, and
 * the URL glob filters. The network BFS is exercised end-to-end via the
 * Knowledge UI.
 */

describe("globToRegExp", () => {
  it("matches * as a wildcard, everything else literally", () => {
    expect(globToRegExp("https://x.edu/*").test("https://x.edu/a/b")).toBe(true);
    expect(globToRegExp("https://x.edu/*").test("https://y.edu/a")).toBe(false);
    expect(globToRegExp("*/blog/*").test("https://x.edu/blog/post-1")).toBe(true);
    expect(globToRegExp("https://x.edu/p?a=1").test("https://x.edu/pXa=1")).toBe(false);
  });
});

describe("extractPage", () => {
  const html = `
    <html><head><title>Chi sono</title><script>var x=1;</script></head>
    <body>
      <nav><a href="/nav-link">Nav</a></nav>
      <main>
        <h1>Alex Bianchi</h1>
        <p>Ingegnere. Ultimo lavoro: <strong>Acme</strong>.</p>
        <a href="/progetti">Progetti</a>
        <a href="https://esterno.com/x">Fuori</a>
        <a href="/cv.pdf">CV</a>
        <a href="mailto:a@b.c">Mail</a>
      </main>
    </body></html>`;

  it("extracts title and visible text, dropping script/nav chrome", () => {
    const { page } = extractPage(html, "https://alexbianchi.example/chi-sono");
    expect(page?.title).toBe("Chi sono");
    expect(page?.text).toContain("Alex Bianchi");
    expect(page?.text).toContain("Ultimo lavoro: Acme");
    expect(page?.text).not.toContain("var x=1");
    expect(page?.text).not.toContain("Nav");
  });

  it("resolves relative links, skips files and non-http schemes", () => {
    const { links } = extractPage(html, "https://alexbianchi.example/chi-sono");
    expect(links).toContain("https://alexbianchi.example/progetti");
    expect(links).toContain("https://esterno.com/x");
    expect(links.some((l) => l.endsWith(".pdf"))).toBe(false);
    expect(links.some((l) => l.startsWith("mailto:"))).toBe(false);
  });

  it("returns no page for empty-body documents", () => {
    const { page } = extractPage("<html><body><script>x</script></body></html>", "https://x.edu");
    expect(page).toBeNull();
  });
});

describe("localCrawl", () => {
  it("stops at its total wall-clock deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = vi.mocked(fetchPinnedPage).mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: '<html><body>First page<a href="/second">Second</a></body></html>',
      };
    });

    const pages = await localCrawl("https://public.example/start", {
      maxPages: 2,
    });

    expect(pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
