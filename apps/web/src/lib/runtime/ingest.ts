import { generateObject } from "ai";
import { z } from "zod";
import type {
  Concept,
  ConceptFrontmatter,
  Db,
  ProviderConnection,
  ResolvedWebsiteCrawlerProvider,
  Source,
  SourceStatus,
  WebsiteSourceConfig,
} from "@agent-hub/db";
import type { CrawledPage } from "./apify";
import {
  browserCrawlerFor,
  crawlCharacteristicsFromConfig,
  crawlOptionsFromConfig,
  localCrawlMissedContent,
  resolvedProviderForRun,
  resolveWebsiteCrawlerProvider,
  websiteCrawlerCapabilities,
  websiteCrawlerAdapter,
} from "./website-crawlers";
import {
  embedTextsWithStatus,
  type EmbeddingUsageContext,
} from "./embeddings";
import { getClassifierModel } from "./models";
import { meterUsage, usageTotals } from "./usage";
import { validateCrawlTarget } from "./crawl-target";
import { redactCrawl4aiSecrets } from "./crawl4ai";
import { errorClassOf, recordRuntimeEvent } from "./telemetry";
import { alertKeys, signalHealth } from "./health";

/** Longer than the bounded cron and configured local-crawl work window. */
export const CRAWL_FINALIZE_LEASE_MS = 2 * 60 * 60_000;

/**
 * Safety ceiling on a stored Concept body. This is a guard against pathological
 * inputs (a runaway multi-megabyte page), **not** a content limit: it is far
 * above any real documentation page, so ordinary long docs keep their full text
 * — `chunkMarkdown` splits an arbitrarily long body into embeddable chunks. The
 * old 60k slice silently dropped the tail of normal doc pages; this does not.
 */
export const MAX_CONCEPT_BODY_CHARS = 1_000_000;

/**
 * Prompt-size guard for LLM enrichment — a *different* concern from the stored
 * body ceiling above. It bounds how much source text is sent to the classifier
 * model in one call (context + token cost). Very large files that exceed this
 * are still truncated for the prompt; chunked/windowed enrichment of huge files
 * is follow-on work (map #398, distillation #404).
 */
export const ENRICH_SOURCE_MAX_CHARS = 60_000;

const CONCEPT_SCHEMA = z.object({
  concepts: z
    .array(
      z.object({
        path: z
          .string()
          .describe("Kebab-case file path ending in .md, e.g. exam-rules.md"),
        type: z.string().describe("Concept type, e.g. Policy, Guide, FAQ, Course Material"),
        title: z.string(),
        description: z.string().describe("One-sentence summary"),
        tags: z.array(z.string()).max(5),
        body: z
          .string()
          .describe("The concept content as markdown, preserving all facts from the source"),
      })
    )
    .min(1)
    .max(12),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "source"
  );
}

/** Splits markdown into ~1200-char chunks on paragraph boundaries. */
export function chunkMarkdown(body: string): string[] {
  const paragraphs = body.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > 1200 && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += paragraph + "\n\n";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/**
 * OKF enrichment (ADR-0002): drafts one Concept per meaningful unit of the
 * source via LLM; falls back to a single concept wrapping the raw text.
 * The enrichment call is a billable model call, so it meters under its own
 * `enrich` stage when the caller supplies attribution (#438).
 */
async function enrich(
  source: Source,
  rawText: string,
  connections: ProviderConnection[],
  attribution: EmbeddingUsageContext | null
): Promise<Array<{ path: string; frontmatter: ConceptFrontmatter; body: string }>> {
  const timestamp = new Date().toISOString();
  const classifier = getClassifierModel("anthropic", connections);
  const text = rawText.slice(0, ENRICH_SOURCE_MAX_CHARS);

  if (classifier) {
    try {
      const { object, usage } = await generateObject({
        model: classifier.model,
        schema: CONCEPT_SCHEMA,
        system:
          "You convert source documents into Open Knowledge Format (OKF) concept documents: one markdown file per coherent concept (a policy, a topic, a procedure). Preserve every fact; do not invent content. Keep concept bodies self-contained.",
        prompt: `Source document "${source.name}":\n\n${text}`,
      });
      if (attribution) {
        await meterUsage(attribution.db, [
          {
            organizationId: attribution.organizationId,
            assistantId: attribution.assistantId ?? null,
            stage: "enrich",
            provider: classifier.provider,
            modelId: classifier.modelId,
            credentialKind: classifier.credentialKind,
            ...usageTotals(usage),
          },
        ]);
      }
      return object.concepts.map((c) => ({
        path: c.path.endsWith(".md") ? c.path : `${c.path}.md`,
        frontmatter: {
          type: c.type,
          title: c.title,
          description: c.description,
          tags: c.tags,
          timestamp,
        },
        body: c.body,
      }));
    } catch {
      // fall through to the naive conversion
    }
  }

  return [
    {
      path: `${slugify(source.name)}.md`,
      frontmatter: {
        type: "Document",
        title: source.name,
        description: `Imported from ${source.kind} source "${source.name}"`,
        timestamp,
      },
      body: text,
    },
  ];
}

/**
 * Enqueues graph-remove syncs for deleted Concepts (best-effort, inert without
 * a graph worker). Dynamic import breaks the cycle with the job ledger, which
 * imports this module.
 */
async function enqueueGraphConceptRemovals(
  db: Db,
  collectionId: string,
  conceptIds: string[]
): Promise<void> {
  if (conceptIds.length === 0) return;
  try {
    const { enqueueGraphSyncJob } = await import("./jobs");
    for (const conceptId of conceptIds) {
      await enqueueGraphSyncJob({ op: "remove", collectionId, conceptId }, { db });
    }
  } catch {
    // Swallow — the graph is derived; the backfill reconciles orphans.
  }
}

/** (Re)indexes a Concept body: chunk → embed → store, title-prefixed. */
export async function embedConcept(options: {
  db: Db;
  assistantId: string;
  collectionId: string;
  conceptId: string;
  title: string;
  body: string;
  connections: ProviderConnection[];
}): Promise<void> {
  const chunks = chunkMarkdown(options.body);
  // Resolved up-front for usage attribution (the embedding call below is
  // billable) and reused by the health signal at the end.
  const assistant = await options.db
    .getAssistant(options.assistantId)
    .catch(() => null);
  if (!assistant) {
    // The call still runs but meters zero — keep that loud, never silent.
    console.warn(
      `[ingest] embedding without usage attribution: assistant ${options.assistantId} not resolvable`
    );
  }
  const { embeddings, mode } = await embedTextsWithStatus(
    chunks,
    options.connections,
    assistant
      ? {
          db: options.db,
          organizationId: assistant.organizationId,
          assistantId: options.assistantId,
        }
      : null
  );
  await options.db.saveChunks(
    chunks.map((content, i) => ({
      conceptId: options.conceptId,
      collectionId: options.collectionId,
      assistantId: options.assistantId,
      content: `${options.title}\n\n${content}`,
      embedding: embeddings[i],
    }))
  );
  // Project this Concept onto its Collection's derived Knowledge Graph too
  // (ADR-0017). This is the single index-write path, so every create / update /
  // re-embed keeps the graph in step without admin action. Inert when the graph
  // worker is unconfigured; best-effort so a graph hiccup never breaks OKF
  // ingestion. Dynamic import avoids an import cycle with the job ledger (which
  // imports this module).
  try {
    const { enqueueGraphSyncJob } = await import("./jobs");
    await enqueueGraphSyncJob(
      {
        op: "ingest",
        collectionId: options.collectionId,
        conceptId: options.conceptId,
      },
      { db: options.db }
    );
  } catch {
    // Swallow — the graph is derived, and OKF (the record) is already written.
    // NOTE: a failure here means no ledger row was created, so the cron backstop
    // cannot recover it; only a manual graph backfill reconciles the miss.
  }
  // An embedding *failure* (provider outage, not mere absence of a provider)
  // silently downgrades the content to lexical-only retrieval — raise an
  // ingestion Alert so it's operationally visible, and auto-resolve it on the
  // next healthy batch. Best-effort: alerting never breaks ingestion (#312).
  const signalsHealth =
    mode === "error" || (mode === "ok" && chunks.length > 0);
  if (signalsHealth) {
    if (assistant) {
      const key = alertKeys.embedding(options.assistantId);
      await signalHealth(
        options.db,
        assistant.organizationId,
        mode === "error"
          ? {
              key,
              healthy: false,
              alert: {
                type: "ingestion",
                title: "Knowledge embedding failed",
                detail:
                  "The embedding provider call failed while indexing knowledge; the affected content is searchable only lexically until it is re-embedded (Knowledge → Re-embed).",
              },
            }
          : { key, healthy: true },
        "ingest"
      );
    }
  }
}

/**
 * Persists one drafted Concept into a Collection and indexes it for
 * retrieval — the single write path every ingestion route (enriched source,
 * crawled page, FAQ) goes through. The retrieval title is the frontmatter
 * title, falling back to the path.
 */
export async function persistConcept(options: {
  db: Db;
  assistantId: string;
  collectionId: string;
  sourceId: string | null;
  path: string;
  frontmatter: ConceptFrontmatter;
  body: string;
  connections: ProviderConnection[];
}): Promise<Concept> {
  const concept = await options.db.createConcept({
    collectionId: options.collectionId,
    sourceId: options.sourceId,
    path: options.path,
    frontmatter: options.frontmatter,
    body: options.body,
  });
  await embedConcept({
    db: options.db,
    assistantId: options.assistantId,
    collectionId: options.collectionId,
    conceptId: concept.id,
    title: options.frontmatter.title ?? options.path,
    body: options.body,
    connections: options.connections,
  });
  return concept;
}

/**
 * Starts a Website Source crawl through its configured provider and records
 * the resolved provider plus run ids, leaving the Source `processing`.
 * Any start-time failure lands the Source in `error` so it never silently
 * hangs on `processing`.
 */
export async function beginWebsiteCrawl(options: {
  db: Db;
  sourceId: string;
}): Promise<void> {
  const { db, sourceId } = options;
  try {
    const source = await db.getSource(sourceId);
    if (!source) throw new Error("Not found");
    const config = source.config;
    if (!config.url) throw new Error("Missing URL in source config");
    await validateCrawlTarget(config.url);

    // Resolve once and persist the result so config/env changes cannot reroute
    // an in-flight crawl between its start and finalization. A failed run never
    // auto-starts another provider — an explicit retry re-runs this policy.
    const resolution = resolveWebsiteCrawlerProvider(
      config.crawlerProvider,
      crawlCharacteristicsFromConfig(config),
      websiteCrawlerCapabilities()
    );
    if ("error" in resolution) throw new Error(resolution.error);
    const resolvedCrawlerProvider = resolution.provider;
    const crawlOptions = crawlOptionsFromConfig(config);
    await db.updateSource(sourceId, {
      status: "processing",
      error: "",
      config: {
        ...config,
        resolvedCrawlerProvider,
        crawlEscalated: undefined,
        crawlRunId: undefined,
        crawlDatasetId: undefined,
      },
    });
    const { runId, datasetId } = await websiteCrawlerAdapter(
      resolvedCrawlerProvider
    ).start(config.url, crawlOptions);

    await db.updateSource(sourceId, {
      status: "processing",
      error: "",
      config: {
        ...config,
        resolvedCrawlerProvider,
        crawlEscalated: undefined,
        crawlRunId: runId,
        crawlDatasetId: datasetId,
        crawlStartedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    await db.updateSource(sourceId, {
      status: "error",
      error: error instanceof Error ? error.message : "Crawl failed to start",
    });
  }
}

/** Saves editable Website Source fields without changing an in-flight run. */
export async function updateWebsiteSourceConfiguration(options: {
  db: Db;
  sourceId: string;
  name: string;
  config: WebsiteSourceConfig;
}): Promise<void> {
  const { db, sourceId, name, config } = options;
  const source = await db.getSource(sourceId);
  if (!source) throw new Error("Not found");
  await db.updateSource(sourceId, {
    name,
    config: {
      ...config,
      resolvedCrawlerProvider: source.config.resolvedCrawlerProvider,
      crawlRunId: source.config.crawlRunId,
      crawlDatasetId: source.config.crawlDatasetId,
    },
  });
}

/**
 * Clears the prior run's identity, then starts a fresh provider crawl. Shared
 * by manual and scheduled (cron) re-crawls so both take the same provider
 * resolution + start path.
 *
 * The source's existing Concepts are deliberately *not* wiped here: they stay
 * live (and searchable) while the replacement crawl runs, and `finalizeWebsiteCrawl`
 * only swaps them out once the new crawl returns at least one usable page. A
 * refresh that fails or comes back empty therefore leaves the previous ready
 * knowledge in place rather than emptying the source.
 */
export async function restartWebsiteCrawl(options: {
  db: Db;
  sourceId: string;
}): Promise<void> {
  const { db, sourceId } = options;
  const source = await db.getSource(sourceId);
  if (!source) throw new Error("Not found");
  await db.updateSource(sourceId, {
    status: "processing",
    error: "",
    config: {
      ...source.config,
      resolvedCrawlerProvider: undefined,
      crawlEscalated: undefined,
      crawlRunId: undefined,
      crawlDatasetId: undefined,
    },
  });
  await beginWebsiteCrawl({ db, sourceId });
}

/**
 * Advances an in-flight website crawl and returns the Source's resulting
 * status. Idempotent and safe to call repeatedly (client poll *and* the cron):
 * - already terminal, or no run attached → returns the current status, no work;
 * - provider run still running → stays `processing`;
 * - provider success → ingests one OKF Concept per page and marks `ready`;
 *   empty or failed runs become `error`.
 * Knowledge replacement is atomic (create-then-delete): the full new set of
 * Concepts is persisted and embedded *before* the Source's prior Concepts are
 * deleted, so a failure part-way through ingest leaves the last-good knowledge
 * intact and the new set never surfaces as `ready`. Because Concepts have no
 * uniqueness constraint on `path` within a Source, old and new coexist for the
 * duration of the ingest without conflict; the prior set is captured by id at
 * attempt start so a retry after an interrupted attempt reconciles any partial
 * new set rather than duplicating it.
 * Also owns the operational-health signal for this Source: any failure raises
 * a `crawl` Alert keyed to the source (deduped/refreshed on repeat failures),
 * and a subsequent successful crawl auto-resolves it.
 */
export async function finalizeWebsiteCrawl(options: {
  db: Db;
  assistantId: string;
  collectionId: string;
  sourceId: string;
  claimedWorkerId?: string;
}): Promise<SourceStatus> {
  const { db, assistantId, collectionId, sourceId } = options;
  const sourceKey = alertKeys.websiteSource(sourceId);
  const workerId = options.claimedWorkerId ?? `crawl-finalize-${crypto.randomUUID()}`;
  let claimed = Boolean(options.claimedWorkerId);

  // Captured once the run is read, then attributed to every terminal telemetry
  // event: the resolved crawler, the worker task/run correlation id, and the
  // crawl's start time (for wall-clock duration). Worker health and
  // memory/concurrency signals are monitored on the worker itself — see
  // services/crawl4ai-worker/RUNBOOK.md §5 (health probe, /metrics, queue
  // depth, memory threshold); this sink carries only the per-crawl outcome.
  let crawlerProvider: ResolvedWebsiteCrawlerProvider | null = null;
  let crawlTaskId: string | null = null;
  let crawlStartedAt: string | undefined;

  /** One `crawl` telemetry event per terminal outcome (fire-safe). */
  const emitCrawlTelemetry = async (input: {
    organizationId: string;
    status: "succeeded" | "failed";
    pageCount?: number | null;
    errorClass?: string | null;
    errorMessage?: string | null;
  }) => {
    await recordRuntimeEvent(db, {
      organizationId: input.organizationId,
      assistantId,
      kind: "crawl",
      status: input.status,
      crawlerProvider,
      pageCount: input.pageCount ?? null,
      durationMs: crawlStartedAt
        ? Math.max(0, Date.now() - Date.parse(crawlStartedAt))
        : null,
      traceId: crawlTaskId,
      errorClass: input.errorClass ?? null,
      errorMessage: input.errorMessage ?? null,
    });
  };

  const renewLease = async () =>
    db.renewProcessingCrawlSourceClaim({
      sourceId,
      workerId,
      now: new Date().toISOString(),
    });

  const defer = async (): Promise<SourceStatus> => {
    // A checked-but-still-running crawl moves to the back of the sweep so a
    // stuck run cannot starve later completed crawls.
    if (await renewLease()) await db.updateSource(sourceId, { status: "processing" });
    return "processing";
  };

  /**
   * Marks the Source `error`, raises/refreshes the crawl Alert for it, and
   * meters a failed `crawl` telemetry event. `message` is redacted of any
   * crawler credential before it can reach the Source, the Alert, or the sink.
   */
  const fail = async (
    message: string,
    errorClass = "CrawlFailed"
  ): Promise<SourceStatus> => {
    if (!(await renewLease())) return "processing";
    const safeMessage = redactCrawl4aiSecrets(message);
    await db.updateSource(sourceId, { status: "error", error: safeMessage });
    try {
      const assistant = await db.getAssistant(assistantId);
      if (assistant) {
        const source = await db.getSource(sourceId);
        await signalHealth(
          db,
          assistant.organizationId,
          {
            key: sourceKey,
            healthy: false,
            alert: {
              type: "crawl",
              title: `Website crawl failed: ${source?.name ?? sourceId}`,
              detail: safeMessage,
            },
          },
          "ingest"
        );
        await emitCrawlTelemetry({
          organizationId: assistant.organizationId,
          status: "failed",
          errorClass,
          errorMessage: safeMessage,
        });
      }
    } catch {
      // Telemetry/lookup is best-effort — never let it mask the real failure.
    }
    return "error";
  };

  try {
    const knownSource = await db.getSource(sourceId);
    if (!knownSource) return "error";
    if (knownSource.status !== "processing") return knownSource.status;
    const now = new Date();
    if (!claimed) {
      claimed = await db.claimProcessingCrawlSource({
        sourceId,
        workerId,
        now: now.toISOString(),
        staleBefore: new Date(now.getTime() - CRAWL_FINALIZE_LEASE_MS).toISOString(),
      });
    }
    if (!claimed) return "processing";

    const source = await db.getSource(sourceId);
    if (!source) return "error";
    if (source.status !== "processing") return source.status;
    const runId = source.config.crawlRunId;
    const datasetId = source.config.crawlDatasetId;
    if (!runId || !datasetId) return defer();

    const resolvedCrawlerProvider = resolvedProviderForRun(source.config);
    if (!resolvedCrawlerProvider) return defer();
    // Attribute every terminal telemetry event for this run.
    crawlerProvider = resolvedCrawlerProvider;
    crawlTaskId = runId;
    crawlStartedAt = source.config.crawlStartedAt;
    const crawlResult = await websiteCrawlerAdapter(resolvedCrawlerProvider).poll({
      runId,
      datasetId,
      url: source.config.url ?? "",
      options: crawlOptionsFromConfig(source.config),
    });
    if (crawlResult.status === "processing") return defer();
    if (crawlResult.status === "failed") {
      return fail(crawlResult.message, "RemoteCrawlFailure");
    }
    const pages: CrawledPage[] = crawlResult.pages;

    // Escalation (#402): a *Local* crawl that extracted nothing has likely hit a
    // JS-rendered site the in-process cheerio crawler can't see. Retry once via
    // a browser provider when one is configured — Local stays the cheap default,
    // and this never discards data: if the browser crawl can't even start we
    // fall through to the usual empty-result handling below.
    if (
      resolvedCrawlerProvider === "local" &&
      !source.config.crawlEscalated &&
      localCrawlMissedContent(pages)
    ) {
      const browserProvider = browserCrawlerFor(websiteCrawlerCapabilities());
      if (browserProvider) {
        if (!(await renewLease())) return "processing";
        try {
          const options = crawlOptionsFromConfig(source.config);
          const started = await websiteCrawlerAdapter(browserProvider).start(
            source.config.url ?? "",
            options
          );
          // Only after a successful start do we flip the run to the browser
          // provider (so a start failure leaves Local's result ingestable).
          await db.updateSource(sourceId, {
            status: "processing",
            error: "",
            config: {
              ...source.config,
              resolvedCrawlerProvider: browserProvider,
              crawlEscalated: true,
              crawlRunId: started.runId,
              crawlDatasetId: started.datasetId,
              crawlStartedAt: new Date().toISOString(),
            },
          });
          return "processing";
        } catch {
          // Browser escalation couldn't start — ingest Local's (thin) result.
        }
      }
    }

    const [assistant, collection] = await Promise.all([
      db.getAssistant(assistantId),
      db.getCollection(collectionId),
    ]);
    if (!assistant || !collection) throw new Error("Not found");
    const connections = await db.listProviderConnections(
      assistant.organizationId
    );

    if (pages.length === 0) {
      return fail("Crawl completed but returned no usable pages.", "EmptyCrawl");
    }

    // Create-then-delete replacement (issue #162), shared with the file/text
    // re-ingest path via `replaceSourceKnowledge` (#191). Lease renewals are
    // the ownership checkpoints: losing the lease at any point aborts without
    // touching knowledge — another worker may already own the replacement.
    const replacement = await replaceSourceKnowledge({
      db,
      collectionId,
      sourceId,
      checkpoint: renewLease,
      persistNewSet: async () => {
        const timestamp = new Date().toISOString();
        const seenPaths = new Set<string>();
        for (const page of pages) {
          if (!(await renewLease())) return "aborted";
          let path = `web/${slugify(page.title)}.md`;
          let suffix = 1;
          while (seenPaths.has(path)) path = `web/${slugify(page.title)}-${++suffix}.md`;
          seenPaths.add(path);
          await persistConcept({
            db,
            assistantId: assistant.id,
            collectionId: collection.id,
            sourceId: source.id,
            path,
            frontmatter: {
              type: "Web Page",
              title: page.title,
              description: page.url,
              resource: page.url,
              timestamp,
            },
            // Store the full page text (chunked + embedded downstream); only a
            // generous pathological-input ceiling applies, not the old 60k slice
            // that silently dropped the tail of long documentation pages.
            body: page.text.slice(0, MAX_CONCEPT_BODY_CHARS),
            connections,
          });
        }
        return "persisted";
      },
    });
    if (replacement === "aborted") return "processing";
    if (!(await renewLease())) return "processing";
    await db.updateSource(sourceId, {
      status: "ready",
      lastCrawledAt: new Date().toISOString(),
    });
    // Crawl recovered — clear any operational alert raised by earlier failures.
    await signalHealth(
      db,
      assistant.organizationId,
      { key: sourceKey, healthy: true },
      "ingest"
    );
    await emitCrawlTelemetry({
      organizationId: assistant.organizationId,
      status: "succeeded",
      pageCount: pages.length,
    });
    return "ready";
  } catch (error) {
    if (!claimed) return "error";
    // A mid-ingest failure already rolled back any partial new set inside
    // `replaceSourceKnowledge` (we hold the claim, so its list-and-diff is
    // race-free); only the terminal status/Alert/telemetry remain to do.
    return fail(
      error instanceof Error ? error.message : "Crawl failed",
      errorClassOf(error)
    );
  } finally {
    if (claimed) {
      try {
        await db.releaseProcessingCrawlSourceClaim({ sourceId, workerId });
      } catch {
        // The lease expires eventually; never hide the crawl result if
        // releasing it fails transiently.
      }
    }
  }
}

/**
 * Replaces a Source's knowledge atomically (create-then-delete, issue #162
 * generalized by #190): captures the Source's current Concept ids as the
 * "prior" set — including any partial debris a crashed earlier attempt left
 * behind — lets the caller persist and embed the FULL new set alongside it,
 * and only then retires the prior set. Because Concepts have no uniqueness
 * constraint on `path` within a Source, old and new coexist (and the old stays
 * searchable) for the duration of the ingest without conflict.
 *
 * Failure semantics:
 * - `persistNewSet` throws → any partial new set is rolled back best-effort
 *   (a rollback error never masks the real failure; the prior-id capture lets
 *   the next successful attempt reconcile leftover debris), then the error is
 *   rethrown so the caller lands the Source in `error`. The prior set is
 *   never touched.
 * - `persistNewSet` returns "aborted", or a `checkpoint` fails → returns
 *   "aborted" with neither commit nor rollback: ownership was lost (e.g. a
 *   crawl-finalize lease expired), so another worker may already be writing.
 *
 * The caller owns the terminal Source status write — "committed" means the
 * replacement is durable and the Source may flip `ready`.
 */
export async function replaceSourceKnowledge(options: {
  db: Db;
  collectionId: string;
  sourceId: string;
  /** Persists (and embeds) the full new Concept set alongside the prior set. */
  persistNewSet: () => Promise<"persisted" | "aborted">;
  /** Optional ownership check (e.g. lease renewal) run before knowledge writes. */
  checkpoint?: () => Promise<boolean>;
}): Promise<"committed" | "aborted"> {
  const { db, collectionId, sourceId, persistNewSet, checkpoint } = options;
  const ownershipHeld = async () => (checkpoint ? checkpoint() : true);

  if (!(await ownershipHeld())) return "aborted";
  const priorConceptIds = (await db.listConcepts(collectionId))
    .filter((c) => c.sourceId === sourceId)
    .map((c) => c.id);

  try {
    if ((await persistNewSet()) === "aborted") return "aborted";
    // Full new set persisted + embedded: now atomically retire the prior set.
    if (!(await ownershipHeld())) return "aborted";
    await db.deleteConceptsByIds(priorConceptIds);
    // The new Concepts got fresh ids, so their graph docs were re-ingested under
    // new keys; retire the prior ids' graph docs too. Best-effort/inert.
    await enqueueGraphConceptRemovals(db, collectionId, priorConceptIds);
    return "committed";
  } catch (error) {
    try {
      const prior = new Set(priorConceptIds);
      const debris = (await db.listConcepts(collectionId))
        .filter((c) => c.sourceId === sourceId && !prior.has(c.id))
        .map((c) => c.id);
      await db.deleteConceptsByIds(debris);
      await enqueueGraphConceptRemovals(db, collectionId, debris);
    } catch {
      // Reconciled on the next successful attempt (see prior-id capture).
    }
    throw error;
  }
}

/**
 * Full ingestion pipeline: enrich → persist Concepts → mark Source ready.
 * Knowledge replacement is atomic — a re-ingest keeps the Source's last-good
 * Concepts live until the full new set commits, and a failure never destroys
 * them (see `replaceSourceKnowledge`); callers must not pre-delete.
 * Also owns the operational-health signal for this Source (parity with the
 * website-crawl producer in `finalizeWebsiteCrawl`): a failure raises an
 * `ingestion` Alert keyed to the source (deduped/refreshed on repeat
 * failures), and a subsequent successful (re-)ingest auto-resolves it.
 */
export async function ingestSource(options: {
  db: Db;
  assistantId: string;
  collectionId: string;
  source: Source;
  rawText: string;
  connections: ProviderConnection[];
}): Promise<void> {
  const { db, assistantId, collectionId, source, rawText, connections } = options;
  const sourceKey = alertKeys.ingestSource(source.id);
  // Resolved up-front so the enrichment call can be attributed to the org;
  // reused by the health signals below.
  const assistant = await db.getAssistant(assistantId).catch(() => null);
  if (!assistant) {
    // The enrichment call still runs but meters zero — keep that loud.
    console.warn(
      `[ingest] enriching without usage attribution: assistant ${assistantId} not resolvable`
    );
  }
  try {
    const concepts = await enrich(
      source,
      rawText,
      connections,
      assistant
        ? { db, organizationId: assistant.organizationId, assistantId }
        : null
    );
    const replacement = await replaceSourceKnowledge({
      db,
      collectionId,
      sourceId: source.id,
      persistNewSet: async () => {
        for (const draft of concepts) {
          await persistConcept({
            db,
            assistantId,
            collectionId,
            sourceId: source.id,
            path: draft.path,
            frontmatter: draft.frontmatter,
            body: draft.body,
            connections,
          });
        }
        return "persisted";
      },
    });
    // No checkpoint is passed today, so an abort can't happen — but only a
    // committed replacement may ever flip the Source ready.
    if (replacement === "aborted") return;
    await db.updateSource(source.id, { status: "ready" });
    // Ingestion recovered — clear any operational alert from earlier failures.
    if (assistant) {
      await signalHealth(
        db,
        assistant.organizationId,
        { key: sourceKey, healthy: true },
        "ingest"
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed";
    await db.updateSource(source.id, { status: "error", error: message });
    if (assistant) {
      await signalHealth(
        db,
        assistant.organizationId,
        {
          key: sourceKey,
          healthy: false,
          alert: {
            type: "ingestion",
            title: `Knowledge ingestion failed: ${source.name}`,
            detail: message,
          },
        },
        "ingest"
      );
    }
  }
}
