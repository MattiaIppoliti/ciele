import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));

import { requireMember } from "@/lib/authz";
import {
  addWebsiteSourceAction,
  recrawlWebsiteSourceAction,
  updateWebsiteSourceAction,
} from "./actions";

describe("Website Source actions", () => {
  const requireMemberMock = vi.mocked(requireMember);
  let db: Db;

  beforeEach(() => {
    db = getMockDb();
    requireMemberMock.mockReset();
    requireMemberMock.mockResolvedValue({ db } as never);
  });

  async function seed(name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    return { assistant, collection };
  }

  it("persists the configured provider when adding a Website Source", async () => {
    const { assistant, collection } = await seed("action-add-provider");

    await addWebsiteSourceAction(assistant.id, collection.id, {
      name: "Local docs",
      url: "https://public.example/docs",
      crawlerProvider: "local",
    });

    const [source] = await db.listSources(collection.id);
    expect(source.config).toMatchObject({
      crawlerProvider: "local",
      resolvedCrawlerProvider: "local",
      crawlRunId: "local",
    });
  });

  it("updates the configured provider without replacing in-flight run identity", async () => {
    const { assistant, collection } = await seed("action-update-provider");
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Docs",
      kind: "website",
      config: {
        url: "https://public.example/docs",
        crawlerProvider: "local",
        resolvedCrawlerProvider: "local",
        crawlRunId: "local",
        crawlDatasetId: "local",
      },
    });

    await updateWebsiteSourceAction(assistant.id, source.id, {
      name: "Docs",
      url: "https://public.example/docs",
      crawlerProvider: "apify",
    });

    expect((await db.getSource(source.id))?.config).toMatchObject({
      crawlerProvider: "apify",
      resolvedCrawlerProvider: "local",
      crawlRunId: "local",
      crawlDatasetId: "local",
    });
  });

  it("starts manual re-crawls with fresh run metadata", async () => {
    const { assistant, collection } = await seed("action-recrawl-provider");
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Docs",
      kind: "website",
      config: {
        url: "https://public.example/docs",
        crawlerProvider: "local",
        resolvedCrawlerProvider: "apify",
        crawlRunId: "old-run",
        crawlDatasetId: "old-dataset",
      },
    });

    await recrawlWebsiteSourceAction(
      assistant.id,
      collection.id,
      source.id
    );

    expect((await db.getSource(source.id))?.config).toMatchObject({
      resolvedCrawlerProvider: "local",
      crawlRunId: "local",
      crawlDatasetId: "local",
    });
  });
});
