import { describe, expect, it } from "vitest";
import {
  buildCrawlInput,
  isRunSuccess,
  isRunTerminal,
  mapCrawledPages,
} from "./apify";

/**
 * The pure crawl-config translation and response mapping, the parts of the
 * Apify integration that carry real rules (page clamp, crawler-type switch,
 * conditional fields, content fallbacks) and would otherwise only be
 * exercised through a live network call.
 */

describe("buildCrawlInput", () => {
  it("defaults to the adaptive JS-capable engine, readable text, a settle wait, 20 pages, markdown", () => {
    const input = buildCrawlInput("https://x.edu");
    expect(input.startUrls).toEqual([{ url: "https://x.edu" }]);
    // Adaptive: renders JS when a page needs it, raw HTTP when it doesn't.
    expect(input.crawlerType).toBe("playwright:adaptive");
    // Strip nav / menu / boilerplate to the main article.
    expect(input.htmlTransformer).toBe("readableText");
    // Dynamic content gets time to settle even without a per-Source wait.
    expect(input.dynamicContentWaitSecs).toBe(10);
    expect(input.maxCrawlPages).toBe(20);
    expect(input.saveMarkdown).toBe(true);
    // Optional fields are absent unless requested.
    expect(input.maxConcurrency).toBeUndefined();
    expect(input.saveFiles).toBeUndefined();
    expect(input.includeUrlGlobs).toBeUndefined();
  });

  it("clamps maxCrawlPages to 50", () => {
    expect(buildCrawlInput("https://x.edu", { maxPages: 500 }).maxCrawlPages).toBe(50);
    expect(buildCrawlInput("https://x.edu", { maxPages: 10 }).maxCrawlPages).toBe(10);
  });

  it("raises the settle wait when a per-Source waitSecs is given (engine stays adaptive)", () => {
    const input = buildCrawlInput("https://x.edu", { waitSecs: 3 });
    expect(input.crawlerType).toBe("playwright:adaptive");
    expect(input.dynamicContentWaitSecs).toBe(3);
  });

  it("maps throttle/fetchFiles/timeout and wraps globs as objects", () => {
    const input = buildCrawlInput("https://x.edu", {
      throttle: true,
      fetchFiles: true,
      pageTimeoutSecs: 45,
      includeGlobs: ["https://x.edu/docs/**"],
      excludeGlobs: ["https://x.edu/private/**"],
    });
    expect(input.maxConcurrency).toBe(1);
    expect(input.saveFiles).toBe(true);
    expect(input.requestTimeoutSecs).toBe(45);
    expect(input.includeUrlGlobs).toEqual([{ glob: "https://x.edu/docs/**" }]);
    expect(input.excludeUrlGlobs).toEqual([{ glob: "https://x.edu/private/**" }]);
  });
});

describe("mapCrawledPages", () => {
  it("prefers markdown, falls back through title → url, drops empty pages", () => {
    const pages = mapCrawledPages(
      [
        {
          url: "https://x.edu/a",
          markdown: "# A",
          text: "ignored",
          metadata: { title: "Page A" },
        },
        { url: "https://x.edu/b", text: "plain B" }, // no markdown, no title
        { markdown: "  " }, // whitespace-only → dropped
        { url: "https://x.edu/d", markdown: "D body" }, // no title
      ],
      "https://x.edu"
    );
    expect(pages).toEqual([
      { url: "https://x.edu/a", title: "Page A", text: "# A" },
      { url: "https://x.edu/b", title: "https://x.edu/b", text: "plain B" },
      { url: "https://x.edu/d", title: "https://x.edu/d", text: "D body" },
    ]);
  });

  it("uses the fallback url and 'Untitled page' when an item omits both", () => {
    const pages = mapCrawledPages([{ markdown: "orphan" }], "https://x.edu");
    expect(pages).toEqual([
      { url: "https://x.edu", title: "Untitled page", text: "orphan" },
    ]);
  });

  it("returns an empty array when every item is empty", () => {
    expect(
      mapCrawledPages([{ markdown: "" }, { text: "   " }], "https://x.edu")
    ).toEqual([]);
  });
});

describe("run status classification", () => {
  it("treats only SUCCEEDED as a successful run", () => {
    expect(isRunSuccess("SUCCEEDED")).toBe(true);
    for (const s of ["RUNNING", "READY", "FAILED", "ABORTED", "TIMED-OUT"]) {
      expect(isRunSuccess(s)).toBe(false);
    }
  });

  it("marks finished runs terminal and in-flight runs non-terminal", () => {
    for (const s of ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]) {
      expect(isRunTerminal(s)).toBe(true);
    }
    for (const s of ["READY", "RUNNING", "ABORTING"]) {
      expect(isRunTerminal(s)).toBe(false);
    }
  });
});
