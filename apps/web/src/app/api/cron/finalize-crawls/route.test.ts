import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";

const mocks = vi.hoisted(() => ({
  claimProcessingCrawlSources: vi.fn(),
  runDueIngestJobs: vi.fn(),
  runDueGraphSyncJobs: vi.fn(),
  runDueProposalJobs: vi.fn(),
  finalizeWebsiteCrawl: vi.fn(),
}));

vi.mock("@/lib/widget-db", () => ({
  getWidgetDb: () =>
    ({
      claimProcessingCrawlSources: mocks.claimProcessingCrawlSources,
    } as unknown as Pick<Db, "claimProcessingCrawlSources">),
}));

vi.mock("@/lib/runtime", () => ({
  CRAWL_FINALIZE_LEASE_MS: 2 * 60 * 60_000,
  finalizeWebsiteCrawl: mocks.finalizeWebsiteCrawl,
  runDueIngestJobs: mocks.runDueIngestJobs,
  runDueGraphSyncJobs: mocks.runDueGraphSyncJobs,
  runDueProposalJobs: mocks.runDueProposalJobs,
}));

import { CRAWL_FINALIZE_BATCH_SIZE, GET } from "./route";

describe("GET /api/cron/finalize-crawls", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.claimProcessingCrawlSources.mockReset();
    mocks.runDueIngestJobs.mockReset();
    mocks.runDueGraphSyncJobs.mockReset();
    mocks.finalizeWebsiteCrawl.mockReset();
    mocks.runDueIngestJobs.mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
    });
    mocks.runDueGraphSyncJobs.mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
    });
    mocks.runDueProposalJobs.mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
    });
    mocks.finalizeWebsiteCrawl.mockResolvedValue("processing");
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("finalizes only one bounded batch, leaving later crawls for another tick", async () => {
    const batch = Array.from({ length: CRAWL_FINALIZE_BATCH_SIZE }, (_, index) => ({
      sourceId: `source-${index}`,
      collectionId: `collection-${index}`,
      assistantId: `assistant-${index}`,
    }));
    mocks.claimProcessingCrawlSources.mockResolvedValue(batch);

    const response = await GET(
      new Request("https://ciele.app/api/cron/finalize-crawls", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(mocks.claimProcessingCrawlSources).toHaveBeenCalledWith(
      expect.objectContaining({ limit: CRAWL_FINALIZE_BATCH_SIZE })
    );
    expect(mocks.finalizeWebsiteCrawl).toHaveBeenCalledTimes(CRAWL_FINALIZE_BATCH_SIZE);
    await expect(response.json()).resolves.toMatchObject({
      crawls: { swept: CRAWL_FINALIZE_BATCH_SIZE, settled: 0 },
    });
  });
});
