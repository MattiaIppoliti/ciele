import type { Source, SourceKind, SourceStatus } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  IMPORT_PREFIX,
  WEBSITE_PREFIX,
  type IngestionActivityItem,
  type IngestionActivitySnapshot,
  type IngestionItemStatus,
  type IngestionRun,
} from "@/lib/ingestion-activity";

/**
 * One poll of the Organization's in-flight ingestion, for the bottom-right
 * activity card.
 *
 * Two questions, answered from what is already durable:
 *
 * - **What is running now**: the Sources sitting at `processing`. One indexed
 *   read, the same one the Library's status filter makes.
 * - **How did the ones I was following end**: `tracked`, the ids the card is
 *   still holding. A Source leaves the `processing` query the instant it
 *   finishes, so without this the card would watch work vanish rather than
 *   succeed. Bounded, and only ever ids the card itself learned from a
 *   previous poll of this Organization.
 *
 * Each run is tallied in the unit it actually produces. A crawl's unit is
 * **pages** (`crawlStagedPages` / `crawlTotalPages`, written by the finalizer
 * in `@agent-hub/agent`), because one website row reporting "0/1" for twenty
 * minutes says nothing about what is arriving. An Import's unit is the
 * documents it maps, which is also its row count, so its header counts the run
 * rather than the four rows the card has space for.
 *
 * The card keeps saying pages while the Library says Documents, and the two do
 * not disagree: one fetched page becomes one stored Document, so the card
 * counts what the crawler brings in and the Library counts what is kept. They
 * land on the same number and describe different moments.
 */

/** Sources reported in flight per poll. A card showing four needs no more. */
const PROCESSING_PAGE_SIZE = 100;
/** Ids the card may ask to have resolved by name in one poll. */
export const TRACKED_ID_LIMIT = 50;
/** Rows sampled from one Import: enough to fill the card and reorder. */
const IMPORT_SAMPLE = 12;

/** The Source kinds whose ingestion is worth a card. */
export const INGESTION_KINDS: SourceKind[] = ["website", "url", "application", "file"];

function isWebsite(source: { kind: string }): boolean {
  return source.kind === "website" || source.kind === "url";
}

export interface TrackedIngestion {
  sources: string[];
  imports: string[];
}

export async function readIngestionActivity(
  db: Db,
  organizationId: string,
  tracked: TrackedIngestion = { sources: [], imports: [] },
): Promise<IngestionActivitySnapshot> {
  const trackedSources = tracked.sources.slice(0, TRACKED_ID_LIMIT);
  const trackedImports = tracked.imports.slice(0, TRACKED_ID_LIMIT);

  const [processing, imports] = await Promise.all([
    db.listOrgKnowledgeSources(organizationId, {
      kinds: INGESTION_KINDS,
      status: "processing",
      pageSize: PROCESSING_PAGE_SIZE,
    }),
    db.listApplicationImports(organizationId),
  ]);

  const inFlight = new Map(processing.items.map((item) => [item.id, item]));

  // The outcomes. `getSource` is RLS-scoped like every other read here, so an
  // id from another Organization resolves to nothing rather than to a leak.
  const settled = (
    await Promise.all(
      trackedSources
        .filter((id) => !inFlight.has(id))
        .map((id) => db.getSource(id).catch(() => null)),
    )
  ).filter((source): source is Source => source !== null);

  const importsById = new Map(imports.map((item) => [item.id, item]));
  const activeImportIds = new Set<string>();
  for (const item of processing.items) {
    const importId = item.config.applicationImportId;
    if (importId && importsById.has(importId)) activeImportIds.add(importId);
  }
  for (const item of imports) {
    // `syncing` covers discovery, before a single Source exists to be listed.
    if (item.status === "syncing") activeImportIds.add(item.id);
  }
  for (const id of trackedImports) {
    if (importsById.has(id)) activeImportIds.add(id);
  }

  const importRuns = await Promise.all(
    [...activeImportIds].map(async (id) => {
      const applicationImport = importsById.get(id)!;
      const sources = (await db.listSources(applicationImport.collectionId)).filter(
        (source) => source.config.applicationImportId === id,
      );
      return importRun(applicationImport.id, applicationImport.name, sources);
    }),
  );

  const crawls = [
    ...processing.items.filter(isWebsite).map((item) =>
      websiteRun({
        id: item.id,
        name: item.name,
        status: item.status,
        error: item.error,
        config: item.config,
        pages: item.conceptCount,
      }),
    ),
    ...settled.filter(isWebsite).map((source) => websiteRun(source)),
  ];

  // Everything else being built right now: an uploaded file, or a document
  // whose Import has since been deleted. One run so the header still adds up;
  // a document an active Import already counts is left to that run.
  const loose = [
    ...processing.items.filter((item) => !isWebsite(item)),
    ...settled.filter((source) => !isWebsite(source)),
  ]
    .filter((source) => {
      const importId = source.config.applicationImportId;
      return !importId || !activeImportIds.has(importId);
    })
    .map(documentItem);

  return {
    runs: [...crawls, ...importRuns, ...(loose.length > 0 ? [looseRun(loose)] : [])],
  };
}

function importRun(id: string, name: string, sources: Source[]): IngestionRun {
  const items = sources.map(documentItem);
  const done = items.filter(isSettled).length;
  return {
    id: `${IMPORT_PREFIX}${id}`,
    title: name,
    unit: "item",
    // One document, one row: for an Import the two counts are the same number.
    done,
    total: items.length,
    rows: items.length,
    rowsDone: done,
    failed: items.filter((item) => item.status === "failed").length,
    // Failures first, then the queue: the sample has to carry what matters,
    // because the card never sees the rows this cut away.
    items: [
      ...items.filter((item) => item.status === "failed"),
      ...items.filter((item) => item.status === "queued"),
      ...items.filter((item) => item.status === "indexed"),
    ].slice(0, IMPORT_SAMPLE),
  };
}

/**
 * The rows that belong to no Import: an uploaded file, or a document whose
 * Import was deleted while the card was following it.
 */
function looseRun(items: IngestionActivityItem[]): IngestionRun {
  const done = items.filter(isSettled).length;
  return {
    id: `${IMPORT_PREFIX}loose`,
    title: "Sources",
    unit: "item",
    done,
    total: items.length,
    rows: items.length,
    rowsDone: done,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  };
}

/**
 * One website, counted in pages.
 *
 * `crawlStagedPages` moves while the finalizer stages, `crawlTotalPages` lands
 * once the crawl's last dataset window is in hand. Before that there is no
 * denominator that would be true, so the run reports a total of 0 and the card
 * shows the phase instead of a fraction.
 */
function websiteRun(source: {
  id: string;
  name: string;
  status: SourceStatus;
  error: string;
  config: Source["config"];
  /** Documents stored under the Source, when the caller's read carried them. */
  pages?: number;
}): IngestionRun {
  const status = statusOf(source.status, "running");
  const total = source.config.crawlTotalPages ?? 0;
  const staged =
    source.config.crawlStagedPages ?? source.config.crawlIngestedPages ?? 0;
  const done = status === "indexed" ? total || source.pages || staged : staged;
  const settled = status !== "running";

  return {
    id: `${WEBSITE_PREFIX}${source.id}`,
    title: source.name,
    unit: "page",
    done,
    total: Math.max(total, done),
    rows: 1,
    rowsDone: settled ? 1 : 0,
    failed: status === "failed" ? 1 : 0,
    items: [
      {
        id: source.id,
        name: source.name,
        status,
        detail: websiteDetail({ status, done, error: source.error }),
      },
    ],
  };
}

function websiteDetail(input: {
  status: IngestionItemStatus;
  done: number;
  error: string;
}): string {
  if (input.status === "failed") return input.error || "Crawl failed";
  // The crawler itself is an opaque provider run: until it hands its pages
  // over there is nothing to count, so the row says which phase it is in.
  if (input.status === "running" && input.done === 0) return "Crawling";
  return `${input.done} ${input.done === 1 ? "page" : "pages"}`;
}

/**
 * `processing` means two different things, so it is read differently on either
 * side. A website at `processing` has a crawler running against it right now.
 * A document at `processing` is waiting for its `ingest_source` job to be
 * claimed off the ledger, which is a queue, and saying "running" about a
 * document that has not been picked up yet would be a lie the card repeats a
 * few hundred times.
 */
function statusOf(
  status: SourceStatus,
  pending: IngestionItemStatus,
): IngestionItemStatus {
  if (status === "processing") return pending;
  return status === "error" ? "failed" : "indexed";
}

function isSettled(item: IngestionActivityItem): boolean {
  return item.status === "indexed" || item.status === "failed";
}

function documentItem(
  source: Pick<Source, "id" | "name" | "status" | "error">,
): IngestionActivityItem {
  const status = statusOf(source.status, "queued");
  return {
    id: source.id,
    name: source.name,
    status,
    detail: status === "failed" ? source.error || "Ingestion failed" : undefined,
  };
}
