import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";

vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  startCrawl: vi.fn(),
}));

vi.mock("./crawl4ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./crawl4ai")>()),
  startCrawl4ai: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./pinned-fetch", () => ({ fetchPinnedPage: vi.fn() }));

import { lookup } from "node:dns/promises";
import { startCrawl } from "./apify";
import { startCrawl4ai } from "./crawl4ai";
import { beginWebsiteCrawl, finalizeWebsiteCrawl } from "./ingest";
import { fetchPinnedPage } from "./pinned-fetch";

function pageResponse(
  text: string,
  status = 200,
  headers: Record<string, string> = { "content-type": "text/html" }
) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text };
}

describe("Website Source crawl target safety", () => {
  const startCrawlMock = vi.mocked(startCrawl);
  const startCrawl4aiMock = vi.mocked(startCrawl4ai);
  const lookupMock = vi.mocked(lookup);
  const fetchMock = vi.mocked(fetchPinnedPage);

  beforeEach(() => {
    startCrawlMock.mockReset();
    startCrawl4aiMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    fetchMock.mockReset();
  });

  it("rejects a loopback target before starting the provider", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Unsafe crawl target",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Unsafe crawl target",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Loopback",
      kind: "website",
      config: {
        url: "http://127.0.0.1/admin",
        crawlerProvider: "apify",
      },
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect(await db.getSource(source.id)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/not allowed|unsafe|private|loopback/i),
    });
  });

  it("rejects an unsafe target before submitting a Crawl4AI job", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Unsafe Crawl4AI target",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Unsafe Crawl4AI target",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Metadata endpoint",
      kind: "website",
      config: {
        url: "http://169.254.169.254/latest/meta-data",
        crawlerProvider: "crawl4ai",
      },
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawl4aiMock).not.toHaveBeenCalled();
    expect(await db.getSource(source.id)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/not allowed|unsafe|private|loopback/i),
    });
  });

  it("rejects non-HTTP crawl targets before starting the provider", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Unsafe crawl scheme",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Unsafe crawl scheme",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Local file",
      kind: "website",
      config: {
        url: "file:///etc/passwd",
        crawlerProvider: "apify",
      },
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.error).toMatch(/http|scheme|protocol/i);
  });

  it("rejects crawl targets containing embedded credentials", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Credentialed crawl target",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Credentialed crawl target",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Credentialed URL",
      kind: "website",
      config: {
        url: "https://admin:secret@example.com/private",
        crawlerProvider: "apify",
      },
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.error).toMatch(/credential/i);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Private DNS crawl target",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Private DNS crawl target",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Private DNS",
      kind: "website",
      config: {
        url: "https://internal.example/admin",
        crawlerProvider: "apify",
      },
    });
    lookupMock.mockResolvedValueOnce([
      { address: "10.0.0.5", family: 4 },
    ] as never);

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.error).toMatch(/private|not allowed|unsafe/i);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1/admin",
    "http://192.168.1.10/admin",
    "http://[::1]/admin",
    "http://[fd00::1]/admin",
    "http://[fe80::1]/admin",
  ])("rejects blocked IP range %s", async (url) => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: `Blocked address ${url}`,
    });
    const collection = await db.createCollection(assistant.id, {
      name: `Blocked address ${url}`,
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Blocked address",
      kind: "website",
      config: { url, crawlerProvider: "apify" },
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.status).toBe("error");
  });

  it.each(["http://localhost/admin", "http://metadata.google.internal/"])(
    "rejects blocked hostname %s before DNS can make it appear public",
    async (url) => {
      const db = getMockDb();
      const assistant = await db.createAssistant(DEMO_ORG.id, {
        title: `Blocked hostname ${url}`,
      });
      const collection = await db.createCollection(assistant.id, {
        name: `Blocked hostname ${url}`,
      });
      const source = await db.createSource({
        collectionId: collection.id,
        name: "Blocked hostname",
        kind: "website",
        config: { url, crawlerProvider: "apify" },
      });

      await beginWebsiteCrawl({ db, sourceId: source.id });

      expect(startCrawlMock).not.toHaveBeenCalled();
      expect((await db.getSource(source.id))?.status).toBe("error");
    }
  );

  it("does not follow a local-crawler redirect into a private target", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Unsafe redirect",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Unsafe redirect",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Unsafe redirect",
      kind: "website",
      config: {
        url: "https://public.example/start",
        crawlerProvider: "local",
      },
    });
    let followedUnsafeRedirect = false;
    fetchMock.mockImplementation(async (target) => {
      if (target.url.hostname === "127.0.0.1") {
        followedUnsafeRedirect = true;
        return pageResponse("<html><body>Private admin content</body></html>");
      }
      return pageResponse("", 302, { location: "http://127.0.0.1/admin" });
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });
    const status = await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect(followedUnsafeRedirect).toBe(false);
    expect((await db.getSource(source.id))?.error).toMatch(/private|loopback/i);
  });

  it("does not follow or ingest a public cross-origin redirect", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Cross-origin redirect",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Cross-origin redirect",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Cross-origin redirect",
      kind: "website",
      config: {
        url: "https://public.example/start",
        crawlerProvider: "local",
      },
    });
    fetchMock
      .mockResolvedValueOnce(
        pageResponse("", 302, { location: "https://other.example/content" })
      )
      .mockResolvedValueOnce(
        pageResponse("<html><body>Other origin content</body></html>")
      );

    await beginWebsiteCrawl({ db, sourceId: source.id });
    const status = await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await db.listConcepts(collection.id)).toHaveLength(0);
    expect((await db.getSource(source.id))?.error).toMatch(/cross-origin/i);
  });

  it("does not treat a lookalike hostname as the same origin", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Lookalike origin",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Lookalike origin",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Lookalike origin",
      kind: "website",
      config: {
        url: "https://public.example/start",
        crawlerProvider: "local",
        maxPages: 2,
      },
    });
    let fetchedLookalike = false;
    fetchMock.mockImplementation(async (target) => {
      if (target.url.hostname === "public.example.evil") fetchedLookalike = true;
      return pageResponse(
        '<html><body>Public content<a href="https://public.example.evil/private">Private</a></body></html>'
      );
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });
    const status = await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(fetchedLookalike).toBe(false);
  });
});
