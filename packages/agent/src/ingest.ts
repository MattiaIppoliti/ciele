import { generateObject } from "ai";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  Concept,
  ConceptFrontmatter,
  OkfSource,
  ProviderConnection,
  ResolvedWebsiteCrawlerProvider,
  Source,
  SourceStatus,
  WebsiteSourceConfig,
} from "@agent-hub/core";
import { isFreeCrawler, okfActor } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { CrawledPage } from "./apify";
import {
  checkpointSourceGeneration,
  clearSourceGenerationCheckpoint,
  commitSourceGeneration,
  openSourceGeneration,
  replaceSourceGeneration,
  sourceGenerationCheckpoint,
} from "./source-generation";
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
  embeddingSpaceId,
  embedTextsWithStatus,
  embeddingConnectionKind,
  type EmbeddingUsageContext,
} from "./embeddings";
import { getEnterpriseCapabilities } from "./ee";
import { getClassifierModel } from "./models";
import { meterUsage, usageTotals } from "./usage";
import { validateEgressTarget } from "./egress";
import { redactCrawl4aiSecrets } from "./crawl4ai";
import { errorClassOf, recordRuntimeEvent } from "./telemetry";
import { alertKeys, signalHealth } from "./health";

export type SourceConceptDraft = {
  path: string;
  frontmatter: ConceptFrontmatter;
  body: string;
};

/** Longer than the bounded cron and configured local-crawl work window. */
export const CRAWL_FINALIZE_LEASE_MS = 2 * 60 * 60_000;

/**
 * Safety ceiling on a stored Concept body. This is a guard against pathological
 * inputs (a runaway multi-megabyte page), **not** a content limit: it is far
 * above any real documentation page, so ordinary long docs keep their full text,
 * `chunkMarkdown` splits an arbitrarily long body into embeddable chunks. The
 * old 60k slice silently dropped the tail of normal doc pages; this does not.
 */
export const MAX_CONCEPT_BODY_CHARS = 1_000_000;

/**
 * Output budget for one enrichment call. Set explicitly rather than inheriting
 * a provider default, because this number *is* the compression ratio: whatever
 * the model cannot say within it gets dropped from the curated layer, and an
 * invisible default made that a silent, provider-dependent decision.
 *
 * 8k is deliberately conservative, `getClassifierModel` can resolve to any
 * provider, including a user-configured `openai_compatible` model with a modest
 * cap, and exceeding a model's own limit is a hard error that would cost us the
 * whole enrichment. The window below is sized to this, not the other way round.
 */
export const ENRICH_MAX_OUTPUT_TOKENS = 8_000;

/**
 * How much source text one enrichment call sees. Sized so its window can be
 * rendered into concepts *within* {@link ENRICH_MAX_OUTPUT_TOKENS} rather than
 * compressed to fit it: ~24k chars is ~6k input tokens, leaving real headroom
 * in an 8k output budget. The old single 60k-char call had no such relationship
 * to its (unset) output cap, so long sources were compressed by arithmetic.
 */
export const ENRICH_WINDOW_CHARS = 24_000;

/**
 * How many windows one Source may spend. Bounded by wall clock, not by cost:
 * enrichment runs inside a job whose route caps at `maxDuration = 300`, and a
 * job killed mid-flight is retried by cron, burning tokens on every attempt
 * without ever finishing. Four sequential calls stay well inside that.
 *
 * Past this the curated layer stops, but nothing is lost from retrieval: the
 * verbatim companion Concept ({@link verbatimDraft}) carries the whole document
 * up to `MAX_CONCEPT_BODY_CHARS`.
 */
export const ENRICH_MAX_WINDOWS = 4;

/**
 * Total span enrichment curates. Everything past it is still stored, indexed
 * and retrievable through the verbatim companion, only un-curated.
 */
export const ENRICH_SOURCE_MAX_CHARS = ENRICH_WINDOW_CHARS * ENRICH_MAX_WINDOWS;

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

/** Stable across batches and retries; equal titles on different URLs stay distinct. */
export function websiteConceptPath(page: Pick<CrawledPage, "title" | "url">): string {
  const urlHash = createHash("sha256").update(page.url).digest("hex").slice(0, 12);
  return `web/${slugify(page.title)}-${urlHash}.md`;
}

/**
 * Packs paragraphs into pieces of at most `cap` chars on paragraph boundaries.
 * With `splitOversized`, the cap is **hard**: a paragraph longer than the cap
 * is split mid-text rather than kept whole (PDF extraction routinely returns
 * pages with no blank lines at all); without it, an oversized paragraph stays
 * whole and the cap is a soft target.
 */
function packParagraphs(
  text: string,
  cap: number,
  splitOversized: boolean
): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    if (splitOversized && paragraph.length > cap) {
      flush();
      for (let i = 0; i < paragraph.length; i += cap) {
        pieces.push(paragraph.slice(i, i + cap));
      }
      continue;
    }
    if (current && current.length + paragraph.length > cap) flush();
    current += paragraph + "\n\n";
  }
  flush();
  return pieces.filter(Boolean);
}

/**
 * Splits source text into enrichment windows on paragraph boundaries, each at
 * most {@link ENRICH_WINDOW_CHARS} (a window is a prompt budget, so the cap is
 * hard), capped at {@link ENRICH_MAX_WINDOWS}.
 */
export function enrichmentWindows(text: string): string[] {
  return packParagraphs(text, ENRICH_WINDOW_CHARS, true).slice(0, ENRICH_MAX_WINDOWS);
}

/** Splits markdown into ~1200-char chunks on paragraph boundaries. */
export function chunkMarkdown(body: string): string[] {
  return packParagraphs(body, 1200, true);
}

/**
 * The OKF `sources` entry (§5.1) recording what a Source's drafted Concepts
 * derive from. `resource` prefers a followable artifact, the page URL for a
 * `url` Source, the retained original's storage key for an uploaded file, and
 * otherwise falls back to a scope descriptor, which §5.1 explicitly permits for
 * material a consumer cannot fetch (pasted text has no artifact to point at).
 * The `id` is the stable footnote key per-claim attribution would use.
 */
function sourceProvenance(source: Source): OkfSource {
  const resource =
    source.config?.url ||
    source.originalObjectPath ||
    `${source.kind} source "${source.name}"`;
  return { id: slugify(source.name), resource, title: source.name };
}

/**
 * OKF `type` of the verbatim companion Concept (see {@link verbatimDraft}).
 * Its own type so the Knowledge browser's type filter can separate curated
 * knowledge from the raw index, and so a consumer can tell the two apart.
 */
export const SOURCE_TEXT_CONCEPT_TYPE = "Source Text";

/**
 * The **verbatim companion Concept**: the source text exactly as extracted,
 * stored and indexed alongside the enriched Concepts.
 *
 * Why it exists: enrichment rewrites. `chunkMarkdown` chunks the Concept body,
 * so before this, the *only* thing the vector index ever saw for a file / URL /
 * pasted-text Source was the model's rewrite, and any detail the rewrite
 * dropped was unreachable no matter how good retrieval was. The enriched
 * Concepts stay the curated, citable layer; this one guarantees nothing in the
 * source is missing from the index.
 *
 * It carries the FULL text, not the `ENRICH_SOURCE_MAX_CHARS` slice: that cap
 * bounds the enrichment *prompt*, so a long document was previously indexed
 * only up to 60k characters. The model still sees just the first 60k, but
 * everything past it is now retrievable, which is the part that decides whether
 * a visitor's question can be answered at all.
 *
 * Written only when enrichment actually ran. With no classifier the
 * pass-through Concept already *is* the verbatim text, and a companion would be
 * an exact duplicate competing with it for the same top-k slots.
 */
function sourceTextDrafts(
  source: Source,
  rawText: string,
  at: string,
  provenance: OkfSource,
  kind: "verbatim" | "passthrough"
): Array<{ path: string; frontmatter: ConceptFrontmatter; body: string }> {
  const parts = packParagraphs(rawText, MAX_CONCEPT_BODY_CHARS, true);
  const base = slugify(source.name);
  return parts.map((body, index) => {
    const suffix = parts.length === 1 ? "" : `-part-${index + 1}`;
    const partLabel = parts.length === 1 ? "" : `, part ${index + 1} of ${parts.length}`;
    const verbatim = kind === "verbatim";
    return {
      path: verbatim
        ? `originals/${base}${suffix}.md`
        : `${base}${suffix}.md`,
      frontmatter: {
        type: verbatim ? SOURCE_TEXT_CONCEPT_TYPE : "Document",
        title: verbatim
          ? `${source.name}, full text${partLabel}`
          : `${source.name}${partLabel}`,
        description: verbatim
          ? `Unedited text of ${source.kind} source "${source.name}", indexed so detail the enrichment did not carry is still retrievable.`
          : `Imported from ${source.kind} source "${source.name}"${partLabel}`,
        generated: {
          by: okfActor.process(
            verbatim ? "okf-verbatim-index" : "okf-ingest-passthrough"
          ),
          at,
        },
        sources: [provenance],
      },
      body,
    };
  });
}

/**
 * OKF enrichment (ADR-0002): drafts one Concept per meaningful unit of the
 * source via LLM, **plus a verbatim companion Concept** carrying the source
 * text unedited ({@link verbatimDraft}), curated knowledge and the raw index
 * side by side. With no classifier it falls back to a single pass-through
 * concept wrapping the raw text, which needs no companion because it already
 * is one. The enrichment call is a billable model call, so it meters under its
 * own `enrich` stage when the caller supplies attribution (#438).
 *
 * Every drafted Concept carries OKF v0.2 provenance: `generated` names the
 * actor that wrote it (the enrichment model, the verbatim indexer, or the
 * pass-through process) and `sources` names the Source it derives from, so a
 * reader can tell machine-drafted knowledge from a verbatim copy without
 * leaving the frontmatter.
 */
async function enrich(
  source: Source,
  rawText: string,
  connections: ProviderConnection[],
  attribution: EmbeddingUsageContext | null
): Promise<SourceConceptDraft[]> {
  const at = new Date().toISOString();
  const provenance = sourceProvenance(source);
  const classifier = getClassifierModel("anthropic", connections);
  const text = rawText.slice(0, ENRICH_SOURCE_MAX_CHARS);

  if (classifier) {
    const windows = enrichmentWindows(text);
    if (rawText.length > ENRICH_SOURCE_MAX_CHARS) {
      // Not an Alert: the verbatim companion below still indexes the whole
      // document, so this degrades curation, not answerability.
      console.warn(
        `[ingest] source "${source.name}" is ${rawText.length} chars; ` +
          `enrichment curates the first ${ENRICH_SOURCE_MAX_CHARS}. The remainder ` +
          `stays retrievable through its verbatim Concept.`
      );
    }
    const drafts: Array<{
      path: string;
      frontmatter: ConceptFrontmatter;
      body: string;
    }> = [];
    const seenPaths = new Set<string>();

    // Sequential, not parallel: bursting four structured-output calls at a
    // provider is the shape that trips rate limits, and the job has the wall
    // clock to spare (see ENRICH_MAX_WINDOWS).
    for (const [index, window] of windows.entries()) {
      try {
        const { object, usage } = await generateObject({
          model: classifier.model,
          schema: CONCEPT_SCHEMA,
          maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
          system:
            "You convert source documents into Open Knowledge Format (OKF) concept documents: one markdown file per coherent concept (a policy, a topic, a procedure). Preserve every fact; do not invent content. Keep concept bodies self-contained.",
          // The model is told which slice it holds so it drafts concepts for
          // *this* part instead of writing a whole-document overview from one.
          prompt:
            windows.length > 1
              ? `Source document "${source.name}" (part ${index + 1} of ${windows.length}). Draft concepts for this part only:\n\n${window}`
              : `Source document "${source.name}":\n\n${window}`,
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
        for (const concept of object.concepts) {
          // Windows are drafted independently, so two of them can land on the
          // same filename; suffix rather than silently writing twin Concepts.
          const base = concept.path.endsWith(".md")
            ? concept.path.slice(0, -3)
            : concept.path;
          let path = `${base}.md`;
          let suffix = 1;
          while (seenPaths.has(path)) path = `${base}-${++suffix}.md`;
          seenPaths.add(path);
          drafts.push({
            path,
            frontmatter: {
              type: concept.type,
              title: concept.title,
              description: concept.description,
              tags: concept.tags,
              generated: { by: okfActor.agent("okf-enricher", classifier.modelId), at },
              sources: [provenance],
            },
            body: concept.body,
          });
        }
      } catch {
        // One window failing (a provider blip, a schema violation) must not
        // discard the windows that succeeded, skip it and keep going.
      }
    }

    if (drafts.length > 0) {
      // The rewrite is lossy by construction (a bounded output budget, at most
      // 12 concepts per window, a bounded number of windows); index the
      // source's own words next to it so nothing it dropped is unreachable.
      return [
        ...drafts,
        ...sourceTextDrafts(source, rawText, at, provenance, "verbatim"),
      ];
    }
    // Every window failed: fall through to the naive conversion, which keeps
    // the full text and so needs no companion.
  }

  return sourceTextDrafts(source, rawText, at, provenance, "passthrough");
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
    // Swallow: the graph is derived; the backfill reconciles orphans.
  }
}

/** Project only the Source generation that retrieval can currently see. */
async function enqueueActiveSourceGraph(
  db: Db,
  collectionId: string,
  sourceId: string
): Promise<void> {
  try {
    const { enqueueGraphSyncJob } = await import("./jobs");
    const concepts = (await db.listConcepts(collectionId)).filter(
      (concept) => concept.sourceId === sourceId
    );
    for (const concept of concepts) {
      await enqueueGraphSyncJob(
        { op: "ingest", collectionId, conceptId: concept.id },
        { db }
      );
    }
  } catch {
    // The graph is derived; manual backfill remains the reconciliation path.
  }
}

/** (Re)indexes a Concept body: chunk → embed → store, title-prefixed. */
export async function embedConcept(options: {
  db: Db;
  assistantId: string;
  collectionId: string;
  conceptId: string;
  /** Avoids an active-only lookup while indexing a staged generation. */
  sourceId?: string | null;
  title: string;
  body: string;
  connections: ProviderConnection[];
  /** A staged generation is projected only after its visibility CAS commits. */
  deferGraphSync?: boolean;
}): Promise<void> {
  const chunks = chunkMarkdown(options.body);
  // Resolved up-front for usage attribution (the embedding call below is
  // billable) and reused by the health signal at the end.
  const assistant = await options.db
    .getAssistant(options.assistantId)
    .catch(() => null);
  if (!assistant) {
    // The call still runs but meters zero: keep that loud, never silent.
    console.warn(
      `[ingest] embedding without usage attribution: assistant ${options.assistantId} not resolvable`
    );
  }
  // Indexing spends the embedding allowance (#510). Gate it here, at the one
  // ingestion write path, rather than inside the embedding helper: a QUERY
  // embedding goes through the same helper and must never be refused, an
  // exhausted indexing budget degrades what can be added to the index, never
  // the ability to search what is already in it.
  const capped =
    assistant !== null &&
    embeddingConnectionKind(options.connections) === "platform" &&
    (
      await getEnterpriseCapabilities()
        .metering.checkUsage({
          organizationId: assistant.organizationId,
          connectionKind: "platform",
          resource: "embedding",
        })
        .catch((error) => {
          // Fail open, like every other accounting read: a broken meter must
          // not stop knowledge from being indexed.
          console.error("[ingest] embedding usage check failed:", error);
          return { outcome: "allow" as const };
        })
    ).outcome === "block";

  const { embeddings, mode } = capped
    ? {
        // Same shape as an absent provider: chunks are stored without vectors,
        // so the content is searchable lexically and a later re-embed fills
        // them in once the window resets.
        embeddings: chunks.map(() => null),
        mode: "capped" as const,
      }
    : await embedTextsWithStatus(
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
  if (capped) {
    console.warn(
      `[ingest] embedding allowance spent for organization ${assistant?.organizationId}, content stored for lexical search only`
    );
  }
  // Chunks carry their Concept's Source so retrieval can scope them by the
  // assistant↔source link table (PRD #726), the only retrieval path since
  // the contract migration; a source-less chunk is unreachable by design.
  const sourceId =
    options.sourceId !== undefined
      ? options.sourceId
      : (
          await options.db.getConcept(options.conceptId).catch(() => null)
        )?.sourceId ?? null;
  // The space is a property of the vector, not of the row: a chunk whose
  // embedding failed carries no space, and gets both when re-embedded
  // (#801, CYB-14).
  const embeddingSpace = embeddingSpaceId(options.connections);
  await options.db.saveChunks(
    chunks.map((content, i) => ({
      conceptId: options.conceptId,
      collectionId: options.collectionId,
      sourceId,
      content: `${options.title}\n\n${content}`,
      embedding: embeddings[i],
      embeddingSpace: embeddings[i] ? embeddingSpace : null,
    }))
  );
  // Project this Concept onto its Collection's derived Knowledge Graph too
  // (ADR-0017). This is the single index-write path, so every create / update /
  // re-embed keeps the graph in step without admin action. Inert when the graph
  // worker is unconfigured; best-effort so a graph hiccup never breaks OKF
  // ingestion. Dynamic import avoids an import cycle with the job ledger (which
  // imports this module).
  if (!options.deferGraphSync) {
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
      // Swallow: the graph is derived, and OKF (the record) is already written.
      // NOTE: a failure here means no ledger row was created, so the cron backstop
      // cannot recover it; only a manual graph backfill reconciles the miss.
    }
  }
  // An embedding *failure* (provider outage, not mere absence of a provider)
  // silently downgrades the content to lexical-only retrieval, raise an
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
 * retrieval, the single write path every ingestion route (enriched source,
 * crawled page, FAQ) goes through. The retrieval title is the frontmatter
 * title, falling back to the path.
 */
export async function persistConcept(options: {
  db: Db;
  assistantId: string;
  collectionId: string;
  sourceId: string | null;
  generationId?: string;
  path: string;
  frontmatter: ConceptFrontmatter;
  body: string;
  connections: ProviderConnection[];
}): Promise<Concept> {
  const concept = await options.db.createConcept({
    collectionId: options.collectionId,
    sourceId: options.sourceId,
    generationId: options.generationId,
    path: options.path,
    frontmatter: options.frontmatter,
    body: options.body,
  });
  if (options.generationId) {
    // A retried batch reuses the staged Concept id. Replace any partial chunks
    // before embedding so a crash cannot duplicate its retrieval footprint.
    await options.db.deleteChunksByConcept(concept.id);
  }
  await embedConcept({
    db: options.db,
    assistantId: options.assistantId,
    collectionId: options.collectionId,
    conceptId: concept.id,
    sourceId: options.sourceId,
    title: options.frontmatter.title ?? options.path,
    body: options.body,
    connections: options.connections,
    deferGraphSync: Boolean(options.generationId),
  });
  return concept;
}

/**
 * Starts a Website Source crawl through its configured provider and records
 * the resolved provider plus run ids, leaving the Source `processing`.
 * Any start-time failure lands the Source in `error` so it never silently
 * hangs on `processing`.
 *
 * Returns whether a run actually started: a crawl refused for budget is not a
 * failure, and the caller (a scheduled sweep especially) needs to tell the two
 * apart rather than report a run it never began.
 */
export type CrawlStartResult =
  | { started: true }
  | {
      started: false;
      /**
       * `refused` means an allowance said no: nothing is wrong with the Source,
       * so its status and knowledge are left alone. `failed` means the start
       * itself broke (bad target, no provider) and the Source is in `error`.
       * The two must stay distinguishable: a caller that rolls back a refusal
       * would wipe a real failure's error message.
       */
      outcome: "refused" | "failed";
      reason: string;
    };

/**
 * Whether the organization owning this Collection may spend scraping budget on a
 * crawl by this crawler, and the visitor-safe reason when it may not.
 *
 * A crawler that costs nothing (the in-process local one) is never gated: there
 * is no budget to spend. Every crawler credential is the platform's own, so the
 * check is always a platform-funded one. Fails OPEN: a broken meter must not
 * stop a crawl.
 */
async function crawlBudgetRefusal(
  db: Db,
  collectionId: string,
  crawler: ResolvedWebsiteCrawlerProvider
): Promise<string | null> {
  if (isFreeCrawler(crawler)) return null;
  try {
    const collection = await db.getCollection(collectionId);
    // Collections carry their Organization directly (PRD #726 contract).
    const organizationId = collection?.organizationId || null;
    if (!organizationId) {
      // Allowing an unattributable crawl is the right call, but never a silent
      // one: it means a crawl ran outside any organization's allowance.
      console.warn(
        `[ingest] crawl not gated: no organization resolvable for collection ${collectionId}`
      );
      return null;
    }
    const outcome = await getEnterpriseCapabilities().metering.checkUsage({
      organizationId,
      connectionKind: "platform",
      resource: "scraping",
    });
    if (outcome.outcome !== "block") return null;
    return `Crawling is paused until the organization's scraping allowance resets (${new Date(outcome.resetsAt).toUTCString()}).`;
  } catch (error) {
    console.error("[ingest] crawl usage check failed (failing open):", error);
    return null;
  }
}

export async function beginWebsiteCrawl(options: {
  db: Db;
  sourceId: string;
}): Promise<CrawlStartResult> {
  const { db, sourceId } = options;
  try {
    const source = await db.getSource(sourceId);
    if (!source) throw new Error("Not found");
    const config = source.config;
    if (!config.url) throw new Error("Missing URL in source config");
    await validateEgressTarget(config.url);

    // Resolve once and persist the result so config/env changes cannot reroute
    // an in-flight crawl between its start and finalization. A failed run never
    // auto-starts another provider, an explicit retry re-runs this policy.
    const resolution = resolveWebsiteCrawlerProvider(
      config.crawlerProvider,
      crawlCharacteristicsFromConfig(config),
      websiteCrawlerCapabilities()
    );
    if ("error" in resolution) throw new Error(resolution.error);
    const resolvedCrawlerProvider = resolution.provider;

    // Crawling spends the scraping allowance (#510). The gate runs AFTER
    // resolution on purpose: the resolved crawler is what costs money, and a
    // crawl that lands on the free in-process crawler must never be refused for
    // budget. A refusal leaves the Source exactly as it was, the previously
    // ingested Concepts and its `ready` status stay, because a spent budget is
    // not a reason to downgrade knowledge that already works.
    const refusal = await crawlBudgetRefusal(
      db,
      source.collectionId,
      resolvedCrawlerProvider
    );
    if (refusal) {
      await db.updateSource(sourceId, {
        config: { ...config, resolvedCrawlerProvider, crawlBlockedReason: refusal },
      });
      return { started: false, outcome: "refused", reason: refusal };
    }

    const crawlOptions = crawlOptionsFromConfig(config);
    await db.updateSource(sourceId, {
      status: "processing",
      error: "",
      config: {
        ...config,
        resolvedCrawlerProvider,
        crawlBlockedReason: undefined,
        crawlEscalated: undefined,
        crawlRunId: undefined,
        crawlDatasetId: undefined,
        crawlIngestCursor: undefined,
        crawlIngestGenerationId: undefined,
        crawlIngestExpectedGenerationId: undefined,
        crawlIngestedPages: undefined,
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
        crawlBlockedReason: undefined,
        crawlEscalated: undefined,
        crawlRunId: runId,
        crawlDatasetId: datasetId,
        crawlIngestCursor: undefined,
        crawlIngestGenerationId: undefined,
        crawlIngestExpectedGenerationId: undefined,
        crawlIngestedPages: undefined,
        crawlStartedAt: new Date().toISOString(),
      },
    });
    return { started: true };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Crawl failed to start";
    await db.updateSource(sourceId, { status: "error", error: reason });
    return { started: false, outcome: "failed", reason };
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
}): Promise<CrawlStartResult> {
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
      crawlIngestCursor: undefined,
      crawlIngestGenerationId: undefined,
      crawlIngestExpectedGenerationId: undefined,
      crawlIngestedPages: undefined,
    },
  });
  const result = await beginWebsiteCrawl({ db, sourceId });
  if (!result.started && result.outcome === "refused") {
    // A re-crawl refused by an allowance must not leave the Source stuck on the
    // `processing` this function just set, with no run behind it, the knowledge
    // it already has is still good, and it must stay claimable by the next
    // scheduled sweep. `ready` is that state; a start FAILURE is left in
    // `error` on purpose, which is why the two outcomes are distinguishable.
    await db.updateSource(sourceId, {
      status: source.status === "processing" ? "ready" : source.status,
      error: "",
    });
  }
  return result;
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
  // memory/concurrency signals are monitored on the worker itself, see
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
      // Telemetry/lookup is best-effort, never let it mask the real failure.
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
      cursor: source.config.crawlIngestCursor,
    });
    if (crawlResult.status === "processing") return defer();
    if (crawlResult.status === "failed") {
      return fail(crawlResult.message, "RemoteCrawlFailure");
    }
    const pages: CrawledPage[] = crawlResult.pages;

    // Escalation (#402): a *Local* crawl that extracted nothing has likely hit a
    // JS-rendered site the in-process cheerio crawler can't see. Retry once via
    // a browser provider when one is configured, Local stays the cheap default,
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
          // Browser escalation couldn't start: ingest Local's (thin) result.
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

    const savedGeneration = sourceGenerationCheckpoint(source.config);
    const alreadyIngested = savedGeneration?.ingestedPages ?? 0;
    if (
      pages.length === 0 &&
      crawlResult.nextCursor === null &&
      alreadyIngested === 0
    ) {
      return fail("Crawl completed but returned no usable pages.", "EmptyCrawl");
    }

    const generation = await openSourceGeneration({
      db,
      sourceId,
      resume: savedGeneration,
    });
    const stagedConfig = savedGeneration
      ? source.config
      : await checkpointSourceGeneration({
          db,
          sourceId,
          config: source.config,
          generation,
          cursor: "0",
          ingestedPages: alreadyIngested,
        });

    // A crash after the CAS but before clearing Source progress resumes here.
    // Do not re-stage the last batch under a generation that is already active.
    const cutoverAlreadyCommitted = generation.alreadyCommitted;
    if (!cutoverAlreadyCommitted) {
      const timestamp = new Date().toISOString();
      for (const page of pages) {
        if (!(await renewLease())) return "processing";
        await persistConcept({
          db,
          assistantId: assistant.id,
          collectionId: collection.id,
          sourceId: source.id,
          generationId: generation.generationId,
          path: websiteConceptPath(page),
          frontmatter: {
            type: "Web Page",
            title: page.title,
            description: page.url,
            resource: page.url,
            generated: { by: okfActor.process("website-crawl"), at: timestamp },
            sources: [
              { id: slugify(page.title), resource: page.url, title: page.title },
            ],
          },
          body: page.text.slice(0, MAX_CONCEPT_BODY_CHARS),
          connections,
        });
      }
    }

    const ingestedPages = alreadyIngested + pages.length;
    if (!cutoverAlreadyCommitted && crawlResult.nextCursor !== null) {
      if (!(await renewLease())) return "processing";
      await checkpointSourceGeneration({
        db,
        sourceId,
        config: stagedConfig,
        generation,
        cursor: crawlResult.nextCursor,
        ingestedPages,
      });
      return "processing";
    }

    const cutover = await commitSourceGeneration({
      db,
      sourceId,
      generation,
      onRetired: (conceptIds) =>
        enqueueGraphConceptRemovals(db, collectionId, conceptIds),
    });
    if (cutover === "superseded") {
      throw new Error("Source knowledge changed while crawl ingestion was running");
    }
    await enqueueActiveSourceGraph(db, collectionId, sourceId);
    if (!(await renewLease())) return "processing";
    await db.updateSource(sourceId, {
      status: "ready",
      lastCrawledAt: new Date().toISOString(),
      config: clearSourceGenerationCheckpoint(source.config),
    });
    // Crawl recovered: clear any operational alert raised by earlier failures.
    await signalHealth(
      db,
      assistant.organizationId,
      { key: sourceKey, healthy: true },
      "ingest"
    );
    await emitCrawlTelemetry({
      organizationId: assistant.organizationId,
      status: "succeeded",
      pageCount: ingestedPages,
    });
    return "ready";
  } catch (error) {
    if (!claimed) return "error";
    // Staged generations are inactive, so a mid-ingest failure cannot replace
    // last-good retrieval. The next retry can resume or reap the staging rows.
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
 * Stages a complete Source generation, then flips retrieval with one database
 * compare-and-swap. Old and new Concepts may coexist physically, but only one
 * complete generation is active. A failed or superseded writer deletes only
 * its own inactive generation and can never damage last-good knowledge.
 */
export async function replaceSourceKnowledge(options: {
  db: Db;
  collectionId: string;
  sourceId: string;
  /** Persists and embeds the full new set under the supplied generation. */
  persistNewSet: (generationId: string) => Promise<"persisted" | "aborted">;
  /** Optional ownership check (e.g. lease renewal) run before knowledge writes. */
  checkpoint?: () => Promise<boolean>;
  generationId?: string;
  expectedActiveGenerationId?: string;
  /** Optional job-fenced cutover used by durable Source ingestion. */
  commitGeneration?: (input: {
    sourceId: string;
    expectedActiveGenerationId: string;
    generationId: string;
  }) => Promise<boolean>;
  /** Keep inactive work so a reclaimed durable job can resume it. */
  preserveStagedOnAbort?: boolean;
}): Promise<"committed" | "aborted"> {
  const { db, collectionId, sourceId, persistNewSet, checkpoint } = options;
  return replaceSourceGeneration({
    db,
    sourceId,
    persistNewSet,
    checkpoint,
    generation: {
      ...(options.generationId
        ? { generationId: options.generationId }
        : {}),
      ...(options.expectedActiveGenerationId
        ? { expectedActiveGenerationId: options.expectedActiveGenerationId }
        : {}),
    },
    commitGeneration: options.commitGeneration,
    preserveStagedOnAbort: options.preserveStagedOnAbort,
    onRetired: (conceptIds) =>
      enqueueGraphConceptRemovals(db, collectionId, conceptIds),
    onCommitted: () => enqueueActiveSourceGraph(db, collectionId, sourceId),
  });
}

/**
 * Full ingestion pipeline: enrich → persist Concepts → mark Source ready.
 * Knowledge replacement is atomic: a re-ingest keeps the Source's last-good
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
  /** Durable-job fence, renewed between bounded Concept writes. */
  renewLease?: () => boolean | Promise<boolean>;
  /** Frozen with the durable payload after the first enrichment pass. */
  drafts?: SourceConceptDraft[] | null;
  initializeAttempt?: (drafts: SourceConceptDraft[]) => Promise<{
    drafts: SourceConceptDraft[];
    generationId: string;
    expectedActiveGenerationId: string;
    cursor: number;
  } | null>;
  persistCursor?: (generationId: string, cursor: number) => Promise<boolean>;
  commitGeneration?: (input: {
    sourceId: string;
    expectedActiveGenerationId: string;
    generationId: string;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const { db, assistantId, collectionId, rawText, connections } = options;
  // A retry may receive an old Source snapshot. Resume and CAS metadata must
  // come from the current row or the next replacement can never commit.
  const source = (await db.getSource(options.source.id)) ?? options.source;
  const sourceKey = alertKeys.ingestSource(source.id);
  // Resolved up-front so the enrichment call can be attributed to the org;
  // reused by the health signals below.
  const assistant = await db.getAssistant(assistantId).catch(() => null);
  if (!assistant) {
    // The enrichment call still runs but meters zero, keep that loud.
    console.warn(
      `[ingest] enriching without usage attribution: assistant ${assistantId} not resolvable`
    );
  }
  try {
    let concepts =
      options.drafts ??
      (await enrich(
        source,
        rawText,
        connections,
        assistant
          ? { db, organizationId: assistant.organizationId, assistantId }
          : null
      ));
    const attempt = options.initializeAttempt
      ? await options.initializeAttempt(concepts)
      : null;
    if (options.initializeAttempt && !attempt) return false;
    if (attempt) concepts = attempt.drafts;
    const generationId =
      attempt?.generationId ??
      source.config.sourceIngestGenerationId ??
      crypto.randomUUID();
    const expectedActiveGenerationId =
      attempt?.expectedActiveGenerationId ??
      source.config.sourceIngestExpectedGenerationId ??
      source.activeGenerationId;
    let cursor = attempt?.cursor ?? source.config.sourceIngestCursor ?? 0;
    if (!options.initializeAttempt && !source.config.sourceIngestGenerationId) {
      await db.updateSource(source.id, {
        config: {
          ...source.config,
          sourceIngestGenerationId: generationId,
          sourceIngestExpectedGenerationId: expectedActiveGenerationId,
          sourceIngestCursor: cursor,
        },
      });
    }
    const replacement =
      source.activeGenerationId === generationId
        ? "committed"
        : await replaceSourceKnowledge({
            db,
            collectionId,
            sourceId: source.id,
            generationId,
            expectedActiveGenerationId,
            preserveStagedOnAbort: true,
            commitGeneration: options.commitGeneration,
            checkpoint: options.renewLease
              ? async () => options.renewLease!()
              : undefined,
            persistNewSet: async (stagedGenerationId) => {
              for (let index = cursor; index < concepts.length; index += 1) {
                if (options.renewLease && !(await options.renewLease())) {
                  return "aborted";
                }
                const draft = concepts[index]!;
                await persistConcept({
                  db,
                  assistantId,
                  collectionId,
                  sourceId: source.id,
                  generationId: stagedGenerationId,
                  path: draft.path,
                  frontmatter: draft.frontmatter,
                  body: draft.body,
                  connections,
                });
                cursor = index + 1;
                if (options.persistCursor) {
                  if (!(await options.persistCursor(generationId, cursor))) {
                    return "aborted";
                  }
                } else {
                  await db.updateSource(source.id, {
                    config: {
                      ...source.config,
                      sourceIngestGenerationId: generationId,
                      sourceIngestExpectedGenerationId: expectedActiveGenerationId,
                      sourceIngestCursor: cursor,
                    },
                  });
                }
              }
              return "persisted";
            },
          });
    if (replacement === "aborted") return false;
    if (options.renewLease && !(await options.renewLease())) return false;
    await db.updateSource(source.id, {
      status: "ready",
      config: {
        ...source.config,
        sourceIngestGenerationId: undefined,
        sourceIngestExpectedGenerationId: undefined,
        sourceIngestCursor: undefined,
      },
    });
    // Ingestion recovered: clear any operational alert from earlier failures.
    if (assistant) {
      await signalHealth(
        db,
        assistant.organizationId,
        { key: sourceKey, healthy: true },
        "ingest"
      );
    }
    return true;
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
    return false;
  }
}
