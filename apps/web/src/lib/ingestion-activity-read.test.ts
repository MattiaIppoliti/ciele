import type {
  ApplicationImport,
  OrgKnowledgeSourceListItem,
  Source,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { describe, expect, it, vi } from "vitest";
import { readIngestionActivity } from "@/lib/ingestion-activity-read";

function hubItem(
  partial: Partial<OrgKnowledgeSourceListItem> & { id: string },
): OrgKnowledgeSourceListItem {
  return {
    collectionId: "col-1",
    name: partial.id,
    kind: "website",
    status: "processing",
    error: "",
    config: {},
    lastCrawledAt: null,
    originalObjectPath: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
    conceptCount: 0,
    answerPreview: "",
    linkedAssistants: [],
    ...partial,
  };
}

function source(partial: Partial<Source> & { id: string }): Source {
  return {
    collectionId: "col-1",
    name: partial.id,
    kind: "application",
    status: "ready",
    error: "",
    config: {},
    recrawlSchedule: "never",
    lastCrawledAt: null,
    originalObjectPath: null,
    activeGenerationId: "gen-1",
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
    ...partial,
  };
}

function applicationImport(
  partial: Partial<ApplicationImport> & { id: string },
): ApplicationImport {
  return {
    organizationId: "org-1",
    connectionId: "conn-1",
    collectionId: "col-1",
    name: "ServiceNow",
    config: {},
    cadence: "manual",
    enabled: true,
    status: "idle",
    checkpoint: {},
    error: "",
    lastSyncedAt: null,
    nextSyncAt: null,
    reservedBytes: 0,
    assistantIds: [],
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
    ...partial,
  };
}

function fakeDb(input: {
  processing?: OrgKnowledgeSourceListItem[];
  imports?: ApplicationImport[];
  sources?: Source[];
  byId?: Record<string, Source | null>;
}) {
  const listSources = vi.fn(async () => input.sources ?? []);
  const getSource = vi.fn(async (id: string) => input.byId?.[id] ?? null);
  const db = {
    listOrgKnowledgeSources: vi.fn(async () => ({
      items: input.processing ?? [],
      total: (input.processing ?? []).length,
      statusCounts: { processing: 0, ready: 0, error: 0 },
    })),
    listApplicationImports: vi.fn(async () => input.imports ?? []),
    listSources,
    getSource,
  } as unknown as Db;
  return { db, listSources, getSource };
}

describe("readIngestionActivity", () => {
  it("counts a crawl in pages, against the total the finalizer recorded", async () => {
    const { db } = fakeDb({
      processing: [
        hubItem({
          id: "src-1",
          name: "docs.example.com",
          config: {
            url: "https://docs.example.com",
            crawlStagedPages: 128,
            crawlTotalPages: 291,
          },
        }),
      ],
    });

    const snapshot = await readIngestionActivity(db, "org-1");

    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      id: "website:src-1",
      title: "docs.example.com",
      unit: "page",
      done: 128,
      total: 291,
      // One website is one row, however many pages it carries.
      rows: 1,
      rowsDone: 0,
    });
    expect(snapshot.runs[0].items[0]).toEqual({
      id: "src-1",
      name: "docs.example.com",
      status: "running",
      detail: "128 pages",
    });
  });

  it("offers no page total until the crawl's last window is in hand", async () => {
    const { db } = fakeDb({
      processing: [
        hubItem({ id: "src-1", name: "site", config: { crawlStagedPages: 40 } }),
      ],
    });
    const snapshot = await readIngestionActivity(db, "org-1");
    // `total` never dips below what is already staged, so progress can only
    // ever be shown as complete or unknown, never as more than 100%.
    expect(snapshot.runs[0]).toMatchObject({ done: 40, total: 40 });
  });

  it("says a crawl that has not staged anything yet is still crawling", async () => {
    const { db } = fakeDb({ processing: [hubItem({ id: "src-1", name: "site" })] });
    const snapshot = await readIngestionActivity(db, "org-1");
    expect(snapshot.runs[0].items[0].detail).toBe("Crawling");
    expect(snapshot.runs[0].total).toBe(0);
  });

  it("says how far the remote crawler has got before any page arrives", async () => {
    const { db } = fakeDb({
      processing: [
        hubItem({
          id: "src-1",
          name: "site",
          config: { crawlRemoteProgress: { crawled: 12, found: 197 } },
        }),
        hubItem({
          id: "src-2",
          name: "other",
          config: { crawlRemoteProgress: { crawled: 1, found: null } },
        }),
      ],
    });
    const snapshot = await readIngestionActivity(db, "org-1");
    const details = Object.fromEntries(
      snapshot.runs.map((run) => [run.items[0].id, run.items[0].detail])
    );
    expect(details).toEqual({
      "src-1": "12 of 197 pages crawled",
      "src-2": "1 page crawled",
    });
    // The remote count is the crawler's, not Ciele's: no page total yet.
    expect(snapshot.runs.every((run) => run.total === 0)).toBe(true);
  });

  it("resolves the outcome of a tracked Source that already left the queue", async () => {
    const { db, getSource } = fakeDb({
      byId: {
        "src-1": source({
          id: "src-1",
          name: "docs.example.com",
          kind: "website",
          status: "error",
          error: "403 from the host",
        }),
      },
    });

    const snapshot = await readIngestionActivity(db, "org-1", {
      sources: ["src-1"],
      imports: [],
    });

    expect(getSource).toHaveBeenCalledWith("src-1");
    expect(snapshot.runs[0]).toMatchObject({ failed: 1, rows: 1, rowsDone: 1 });
    expect(snapshot.runs[0].items[0]).toEqual({
      id: "src-1",
      name: "docs.example.com",
      status: "failed",
      detail: "403 from the host",
    });
  });

  it("never re-reads a Source the in-flight query already answered for", async () => {
    const { db, getSource } = fakeDb({
      processing: [hubItem({ id: "src-1" })],
    });
    await readIngestionActivity(db, "org-1", { sources: ["src-1"], imports: [] });
    expect(getSource).not.toHaveBeenCalled();
  });

  it("tallies an Import over every document it maps, not over the sample", async () => {
    const documents = [
      ...Array.from({ length: 3 }, (_, i) =>
        source({
          id: `doc-queued-${i}`,
          status: "processing",
          config: { applicationImportId: "imp-1" },
        }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        source({ id: `doc-ok-${i}`, config: { applicationImportId: "imp-1" } }),
      ),
      source({
        id: "doc-bad",
        status: "error",
        error: "unsupported media type",
        config: { applicationImportId: "imp-1" },
      }),
      // Another Import's document in the same Collection: not this run's.
      source({ id: "other", config: { applicationImportId: "imp-2" } }),
    ];
    const { db } = fakeDb({
      processing: [
        hubItem({
          id: "doc-queued-0",
          kind: "application",
          config: { applicationImportId: "imp-1" },
        }),
      ],
      imports: [applicationImport({ id: "imp-1" })],
      sources: documents,
    });

    const snapshot = await readIngestionActivity(db, "org-1");

    expect(snapshot.runs).toHaveLength(1);
    const [run] = snapshot.runs;
    expect(run).toMatchObject({
      id: "import:imp-1",
      title: "ServiceNow",
      unit: "item",
      total: 24,
      rows: 24,
      failed: 1,
    });
    expect(run.done).toBe(21);
    expect(run.rowsDone).toBe(21);
    // Failures lead the sample, so the card can never cut one away.
    expect(run.items[0]).toMatchObject({ id: "doc-bad", status: "failed" });
    expect(run.items.filter((item) => item.status === "queued")).toHaveLength(3);
    // And the in-flight document is counted by the run, not twice.
    expect(snapshot.runs).toHaveLength(1);
  });

  it("follows an Import that is still discovering, before a Source exists", async () => {
    const { db } = fakeDb({
      imports: [applicationImport({ id: "imp-1", status: "syncing" })],
    });
    const snapshot = await readIngestionActivity(db, "org-1");
    expect(snapshot.runs).toEqual([
      {
        id: "import:imp-1",
        title: "ServiceNow",
        unit: "item",
        done: 0,
        total: 0,
        rows: 0,
        rowsDone: 0,
        failed: 0,
        items: [],
      },
    ]);
  });

  it("leaves an idle Organization with nothing to show and nothing to read", async () => {
    const { db, listSources } = fakeDb({});
    const snapshot = await readIngestionActivity(db, "org-1");
    expect(snapshot).toEqual({ runs: [] });
    expect(listSources).not.toHaveBeenCalled();
  });

  it("counts an uploaded file that belongs to no Import", async () => {
    const { db } = fakeDb({
      processing: [hubItem({ id: "file-1", name: "handbook.pdf", kind: "file" })],
    });
    const snapshot = await readIngestionActivity(db, "org-1");
    expect(snapshot.runs[0]).toMatchObject({
      unit: "item",
      total: 1,
      done: 0,
      items: [{ id: "file-1", name: "handbook.pdf", status: "queued" }],
    });
  });
});
