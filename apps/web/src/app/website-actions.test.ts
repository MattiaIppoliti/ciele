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
    // runOperation-backed actions read the session too (org, role, email).
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: {
        organization: DEMO_ORG,
        userId: "test-user",
        role: "editor",
        email: "test@ciele.local",
      },
    } as never);
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

  it("links the new Website Source to the assistant that added it", async () => {
    const { assistant, collection } = await seed("action-add-links");

    await addWebsiteSourceAction(assistant.id, collection.id, {
      name: "Local docs",
      url: "https://public.example/docs",
      crawlerProvider: "local",
    });

    // Retrieval reads the link set alone (#733), and `createSource` stopped
    // auto-linking when Collections became org-owned: without an explicit link
    // the site would be crawled, indexed, and never retrieved.
    const [source] = await db.listSources(collection.id);
    expect(await db.listAssistantSourceIds(assistant.id)).toEqual([source.id]);
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
