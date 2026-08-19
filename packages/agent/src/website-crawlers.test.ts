import { describe, expect, it } from "vitest";
import { LOCAL_CRAWL_MAX_PAGES, LOCAL_CRAWL_RUN } from "./local-crawl";
import {
  browserCrawlerFor,
  crawlCharacteristicsFromConfig,
  localCrawlMissedContent,
  resolvedProviderForRun,
  resolveWebsiteCrawlerProvider,
  type WebsiteCrawlCharacteristics,
  type WebsiteCrawlerCapabilities,
} from "./website-crawlers";

const STATIC: WebsiteCrawlCharacteristics = {
  fetchFiles: false,
  loginProtected: false,
  browserRendered: false,
  exceedsLocalCap: false,
};

const caps = (
  apifyConfigured: boolean,
  crawl4aiConfigured: boolean
): WebsiteCrawlerCapabilities => ({ apifyConfigured, crawl4aiConfigured });

describe("resolveWebsiteCrawlerProvider, explicit choices", () => {
  it("honors an explicit Local choice even when Apify is configured", () => {
    expect(
      resolveWebsiteCrawlerProvider("local", STATIC, caps(true, true))
    ).toEqual({ provider: "local" });
  });

  it("honors an explicit Apify choice when Apify is configured", () => {
    expect(
      resolveWebsiteCrawlerProvider("apify", STATIC, caps(true, false))
    ).toEqual({ provider: "apify" });
  });

  it("honors an explicit Apify choice even when Apify is not configured", () => {
    // Not rerouted: the adapter surfaces the missing token at crawl start.
    expect(
      resolveWebsiteCrawlerProvider("apify", STATIC, caps(false, true))
    ).toEqual({ provider: "apify" });
  });

  it("honors an explicit Crawl4AI choice when its worker is configured", () => {
    expect(
      resolveWebsiteCrawlerProvider("crawl4ai", STATIC, caps(false, true))
    ).toEqual({ provider: "crawl4ai" });
  });

  it("honors an explicit Crawl4AI choice even when its worker is not configured", () => {
    expect(
      resolveWebsiteCrawlerProvider("crawl4ai", STATIC, caps(true, false))
    ).toEqual({ provider: "crawl4ai" });
  });
});

describe("resolveWebsiteCrawlerProvider, Automatic", () => {
  it("routes a small static crawl to Local even when remote crawlers exist", () => {
    expect(resolveWebsiteCrawlerProvider("auto", STATIC, caps(true, true))).toEqual({
      provider: "local",
    });
  });

  it("treats a missing configured provider as Automatic", () => {
    expect(
      resolveWebsiteCrawlerProvider(undefined, STATIC, caps(true, true))
    ).toEqual({ provider: "local" });
  });

  it("routes a browser-rendered crawl to Crawl4AI when configured", () => {
    expect(
      resolveWebsiteCrawlerProvider(
        "auto",
        { ...STATIC, browserRendered: true },
        caps(true, true)
      )
    ).toEqual({ provider: "crawl4ai" });
  });

  it("routes a larger-than-local crawl to Crawl4AI when configured", () => {
    expect(
      resolveWebsiteCrawlerProvider(
        "auto",
        { ...STATIC, exceedsLocalCap: true },
        caps(true, true)
      )
    ).toEqual({ provider: "crawl4ai" });
  });

  it("falls back a browser-rendered crawl to Apify when Crawl4AI is absent", () => {
    expect(
      resolveWebsiteCrawlerProvider(
        "auto",
        { ...STATIC, browserRendered: true },
        caps(true, false)
      )
    ).toEqual({ provider: "apify" });
  });

  it("errors on a browser-rendered crawl when no remote crawler is configured", () => {
    const result = resolveWebsiteCrawlerProvider(
      "auto",
      { ...STATIC, browserRendered: true },
      caps(false, false)
    );
    expect(result).toHaveProperty("error");
  });

  it("reserves file-download crawls for Apify", () => {
    expect(
      resolveWebsiteCrawlerProvider(
        "auto",
        { ...STATIC, fetchFiles: true },
        caps(true, true)
      )
    ).toEqual({ provider: "apify" });
  });

  it("reserves login-protected crawls for Apify", () => {
    expect(
      resolveWebsiteCrawlerProvider(
        "auto",
        { ...STATIC, loginProtected: true },
        caps(true, true)
      )
    ).toEqual({ provider: "apify" });
  });

  it("errors on a file-download crawl when Apify is not configured", () => {
    const result = resolveWebsiteCrawlerProvider(
      "auto",
      { ...STATIC, fetchFiles: true },
      caps(false, true)
    );
    expect(result).toHaveProperty("error");
    if ("error" in result) expect(result.error).toMatch(/Apify/);
  });
});

describe("crawlCharacteristicsFromConfig", () => {
  it("reads traits from a Source's own config fields", () => {
    expect(
      crawlCharacteristicsFromConfig({
        fetchFiles: true,
        loginProtected: true,
        waitSecs: 2,
        maxPages: LOCAL_CRAWL_MAX_PAGES + 1,
      })
    ).toEqual({
      fetchFiles: true,
      loginProtected: true,
      browserRendered: true,
      exceedsLocalCap: true,
    });
  });

  it("treats a page budget within the local cap as static/small", () => {
    expect(
      crawlCharacteristicsFromConfig({ maxPages: LOCAL_CRAWL_MAX_PAGES })
    ).toEqual({
      fetchFiles: false,
      loginProtected: false,
      browserRendered: false,
      exceedsLocalCap: false,
    });
  });

  it("defaults an empty config to a static/small crawl", () => {
    expect(crawlCharacteristicsFromConfig({})).toEqual({
      fetchFiles: false,
      loginProtected: false,
      browserRendered: false,
      exceedsLocalCap: false,
    });
  });
});

describe("resolvedProviderForRun", () => {
  it("prefers the provider persisted when the run started", () => {
    expect(
      resolvedProviderForRun({
        resolvedCrawlerProvider: "local",
        crawlRunId: "run-1",
      })
    ).toBe("local");
  });

  it("maps a legacy local marker without provider metadata to Local", () => {
    expect(resolvedProviderForRun({ crawlRunId: LOCAL_CRAWL_RUN })).toBe("local");
  });

  it("maps a legacy remote run id without provider metadata to Apify", () => {
    expect(resolvedProviderForRun({ crawlRunId: "aBcD123" })).toBe("apify");
  });

  it("returns null when no run has started", () => {
    expect(resolvedProviderForRun({})).toBeNull();
  });
});

describe("localCrawlMissedContent (thin-Local escalation signal)", () => {
  it("is true only when Local extracted no usable pages", () => {
    expect(localCrawlMissedContent([])).toBe(true);
    expect(localCrawlMissedContent([{ text: "" }])).toBe(false); // page present (mapping already drops empties)
    expect(localCrawlMissedContent([{ text: "a" }, { text: "b" }])).toBe(false);
  });
});

describe("browserCrawlerFor (escalation target)", () => {
  const caps = (
    crawl4aiConfigured: boolean,
    apifyConfigured: boolean
  ): WebsiteCrawlerCapabilities => ({ crawl4aiConfigured, apifyConfigured });

  it("prefers the self-hosted Crawl4AI, then managed Apify, else none", () => {
    expect(browserCrawlerFor(caps(true, true))).toBe("crawl4ai");
    expect(browserCrawlerFor(caps(true, false))).toBe("crawl4ai");
    expect(browserCrawlerFor(caps(false, true))).toBe("apify");
    expect(browserCrawlerFor(caps(false, false))).toBeNull();
  });
});
