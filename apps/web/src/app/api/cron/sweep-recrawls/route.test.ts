import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db, DueRecrawlClaim } from "@agent-hub/db";

const mocks = vi.hoisted(() => ({
  claimDueRecrawlSources: vi.fn(),
  restartWebsiteCrawl: vi.fn(),
}));

vi.mock("@/lib/widget-db", () => ({
  getWidgetDb: () =>
    ({
      claimDueRecrawlSources: mocks.claimDueRecrawlSources,
    } as unknown as Pick<Db, "claimDueRecrawlSources">),
}));

vi.mock("@/lib/runtime", () => ({
  restartWebsiteCrawl: mocks.restartWebsiteCrawl,
}));

import { RECRAWL_SWEEP_BATCH_SIZE, GET } from "./route";

type DueSource = { sourceId: string; collectionId: string; assistantId: string };

const authed = () =>
  new Request("https://ciele.app/api/cron/sweep-recrawls", {
    headers: { authorization: "Bearer cron-secret" },
  });

describe("GET /api/cron/sweep-recrawls", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.claimDueRecrawlSources.mockReset();
    mocks.restartWebsiteCrawl.mockReset();
    mocks.claimDueRecrawlSources.mockResolvedValue([]);
    // The start op reports whether a run actually began (#510).
    mocks.restartWebsiteCrawl.mockResolvedValue({ started: true });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("refuses to run when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(authed());
    expect(response.status).toBe(503);
    expect(mocks.claimDueRecrawlSources).not.toHaveBeenCalled();
  });

  it("rejects a request without the cron bearer token", async () => {
    const response = await GET(
      new Request("https://ciele.app/api/cron/sweep-recrawls")
    );
    expect(response.status).toBe(401);
    expect(mocks.claimDueRecrawlSources).not.toHaveBeenCalled();
  });

  it("claims a bounded batch and re-crawls each due Source through the manual pipeline", async () => {
    const batch: DueSource[] = Array.from(
      { length: RECRAWL_SWEEP_BATCH_SIZE },
      (_, index) => ({
        sourceId: `source-${index}`,
        collectionId: `collection-${index}`,
        assistantId: `assistant-${index}`,
      })
    );
    mocks.claimDueRecrawlSources.mockResolvedValue(batch);

    const response = await GET(authed());

    expect(mocks.claimDueRecrawlSources).toHaveBeenCalledWith(
      expect.objectContaining({ limit: RECRAWL_SWEEP_BATCH_SIZE })
    );
    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledTimes(RECRAWL_SWEEP_BATCH_SIZE);
    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "source-0" })
    );
    await expect(response.json()).resolves.toMatchObject({
      recrawls: { swept: RECRAWL_SWEEP_BATCH_SIZE, launched: RECRAWL_SWEEP_BATCH_SIZE },
    });
  });

  it("does not double-crawl when the sweep runs twice in a window", async () => {
    // The claim flips a due Source to `processing`, so the same Source is not
    // returned again within the window — mirror that state transition here.
    const due: DueSource[] = [
      { sourceId: "s-1", collectionId: "c-1", assistantId: "a-1" },
    ];
    const claimed = new Set<string>();
    mocks.claimDueRecrawlSources.mockImplementation(
      async ({ limit }: DueRecrawlClaim) =>
        due
          .filter((row) => !claimed.has(row.sourceId))
          .slice(0, limit)
          .map((row) => {
            claimed.add(row.sourceId);
            return row;
          })
    );

    await GET(authed());
    await GET(authed());

    expect(mocks.claimDueRecrawlSources).toHaveBeenCalledTimes(2);
    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledTimes(1);
    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "s-1" })
    );
  });

  it("reports a re-crawl refused for budget as skipped, not as launched", async () => {
    // A crawl the scraping allowance refused (#510) is neither a run nor a
    // failure; a sweep that counted it as launched would claim work it never did.
    mocks.claimDueRecrawlSources.mockResolvedValue([
      { sourceId: "ok", collectionId: "c", assistantId: "a" },
      { sourceId: "capped", collectionId: "c", assistantId: "a" },
    ]);
    mocks.restartWebsiteCrawl.mockImplementation(
      async ({ sourceId }: { sourceId: string }) =>
        sourceId === "capped"
          ? { started: false, reason: "Crawling is paused until the allowance resets." }
          : { started: true }
    );

    const response = await GET(authed());

    await expect(response.json()).resolves.toMatchObject({
      recrawls: {
        swept: 2,
        launched: 1,
        results: expect.arrayContaining([
          expect.objectContaining({
            sourceId: "capped",
            status: "skipped",
            message: expect.stringMatching(/paused/i),
          }),
        ]),
      },
    });
  });

  it("reports a failed re-crawl without aborting the rest of the batch", async () => {
    mocks.claimDueRecrawlSources.mockResolvedValue([
      { sourceId: "ok", collectionId: "c", assistantId: "a" },
      { sourceId: "boom", collectionId: "c", assistantId: "a" },
    ]);
    mocks.restartWebsiteCrawl.mockImplementation(
      async ({ sourceId }: { sourceId: string }) => {
        if (sourceId === "boom") throw new Error("Not found");
        return { started: true };
      }
    );

    const response = await GET(authed());

    await expect(response.json()).resolves.toMatchObject({
      recrawls: {
        swept: 2,
        launched: 1,
        results: expect.arrayContaining([
          expect.objectContaining({ sourceId: "boom", status: "error", message: "Not found" }),
        ]),
      },
    });
  });
});
