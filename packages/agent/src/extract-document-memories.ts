/**
 * Memory extraction for one Document (ticket ciele-org#930).
 *
 * A crawl commits a generation; one durable job per stored Document then asks
 * the Organization's classifier-tier model for that page's durable facts and
 * writes them as knowledge memories. The Document is searchable through its
 * chunks the moment the generation commits: nothing here is on that path.
 *
 * Every gate resolves into a recorded outcome rather than a throw, because a
 * throw is a retry and most of these are not worth retrying: no Provider
 * Connection is a configuration fact, an unchanged body is a no-op, and a
 * missing Document means the page left the site. Only a model or database
 * failure reaches the ledger's attempt counter.
 */

import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import {
  KNOWLEDGE_MEMORY_CAP,
  filterExtractedMemories,
  reconcileKnowledgeMemories,
  type ExtractedMemory,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { getClassifierModel } from "./models";
import { meterUsage } from "./usage";
import { alertKeys, signalHealth } from "./health";

/** How much of a page the extractor reads, matching the summariser's bound. */
export const EXTRACTION_INPUT_CHARS = 12_000;

const EXTRACTION_SCHEMA = z.object({
  memories: z
    .array(
      z.object({
        text: z
          .string()
          .max(500)
          .describe(
            "One durable fact as a standalone sentence. Name the subject, never 'it' or 'this page'. Resolve dates against the page. One fact per entry."
          ),
        quote: z
          .string()
          .max(1000)
          .describe(
            "The span of the document this sentence rests on, copied VERBATIM. An entry whose quote is not in the document is discarded."
          ),
      })
    )
    .max(KNOWLEDGE_MEMORY_CAP * 2),
});

const SYSTEM = [
  "You extract the durable facts a document states, for colleagues who will read them later without the document.",
  "A durable fact is one that stays true: a policy, a rule, a date, a name, a number, a definition.",
  "Write each as a standalone sentence in the language of the document. Name the subject; never write 'it', 'this page' or 'the company' when the document names something.",
  "Resolve relative dates against the document itself. Never infer, never combine two statements into a conclusion the document does not draw.",
  "Copy a verbatim span of the document as the quote for each fact. An entry whose quote is not in the document is thrown away.",
  "Many documents hold no durable facts at all. An index, a navigation page, a login page or a list of links should return an empty array, and that is a correct answer.",
].join(" ");

/** The body hash the record gates on. */
export function hashDocumentBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export interface ExtractDocumentMemoriesInput {
  db: Db;
  organizationId: string;
  collectionId: string;
  sourceId: string;
  documentPath: string;
  /** The ledger's attempt count, recorded so a failure says how hard we tried. */
  attempt?: number;
}

export type ExtractionOutcome =
  | "extracted"
  | "unchanged"
  | "no_provider"
  | "no_document";

/**
 * Runs one Document's extraction. Throws only where a retry could help.
 */
export async function extractDocumentMemories(
  input: ExtractDocumentMemoriesInput
): Promise<ExtractionOutcome> {
  const { db, sourceId, documentPath } = input;
  const attempts = input.attempt ?? 1;

  // Looked up by the pair the record is keyed on, over the active generation's
  // (source_id, path) index, rather than by scanning the Source's Documents:
  // a page beyond the first five hundred is still a page.
  const document = await db.getSourceDocumentByPath(sourceId, documentPath);
  // The page left the site between the commit and this job. Its memories stay
  // where they are (nothing deletes what a Member may have touched); there is
  // simply nothing to extract from.
  if (!document) return "no_document";

  const bodyHash = hashDocumentBody(document.body);
  const record = await db.getMemoryExtraction(sourceId, documentPath);
  // The hash gate. A crawl stages a fresh generation every time, so without
  // this a weekly re-crawl of an unchanged site pays for every page, weekly.
  if (record?.status === "done" && record.bodyHash === bodyHash) return "unchanged";

  const connections = await db.listProviderConnections(input.organizationId);
  const classifier = getClassifierModel("anthropic", connections);
  if (!classifier) {
    await db.recordMemoryExtraction({
      ...recordBase(input),
      bodyHash: null,
      status: "skipped_no_provider",
      memoryCount: record?.memoryCount ?? 0,
      capped: false,
      attempts,
      lastError: null,
      extractedAt: null,
    });
    // Deliberately no Alert: nagging about a feature nobody turned on.
    return "no_provider";
  }

  const body = document.body.slice(0, EXTRACTION_INPUT_CHARS);
  const { object, usage } = await generateObject({
    model: classifier.model,
    schema: EXTRACTION_SCHEMA,
    system: SYSTEM,
    prompt: [
      `Title: ${document.frontmatter.title ?? document.path}`,
      body.length < document.body.length
        ? "Document (truncated; extract only from what is here):"
        : "Document:",
      `"""${body}"""`,
    ].join("\n"),
  });

  await meterUsage(db, [
    {
      organizationId: input.organizationId,
      assistantId: null,
      stage: "memory_extract",
      provider: classifier.provider,
      modelId: classifier.modelId,
      credentialKind: classifier.credentialKind,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      surface: "ingestion",
    },
  ]);

  // The quote gate runs against the WHOLE body, not the truncated prompt: a
  // model quoting text it was given is quoting the page either way.
  const filtered = filterExtractedMemories(
    object.memories as ExtractedMemory[],
    document.body
  );

  const existing = await db.table("knowledgeMemories").list({
    sourceId,
    documentPath,
  });
  const plan = reconcileKnowledgeMemories(
    existing.map((memory) => ({
      id: memory.id,
      text: memory.text,
      sourceCount: memory.sourceCount,
      forgottenAt: memory.forgottenAt,
    })),
    filtered.kept
  );

  const chunks = await listAllChunks(db, document.id);
  const generated = {
    by: `knowledge-memory-extractor/${classifier.modelId}`,
    at: new Date().toISOString(),
  };

  for (const entry of plan.inserts) {
    await db.table("knowledgeMemories").insert({
      organizationId: input.organizationId,
      collectionId: input.collectionId,
      sourceId,
      documentPath,
      conceptId: document.id,
      chunkId: chunkFor(entry.quote, chunks),
      text: entry.text,
      quote: entry.quote,
      sourceCount: 1,
      generatedBy: generated.by,
      generatedAt: generated.at,
    });
  }
  for (const restated of plan.restated) {
    // Note what is absent: `forgottenAt` and `forgetReason`. A fact a Member
    // forgot stays forgotten however often the page repeats it.
    await db.table("knowledgeMemories").update(restated.id, {
      sourceCount: restated.sourceCount,
      conceptId: document.id,
      chunkId: chunkFor(restated.quote, chunks),
      quote: restated.quote,
    });
  }

  await db.recordMemoryExtraction({
    ...recordBase(input),
    bodyHash,
    status: "done",
    memoryCount: plan.inserts.length + plan.restated.length,
    capped: filtered.capped,
    attempts,
    lastError: null,
    extractedAt: generated.at,
  });
  return "extracted";
}

/**
 * Records a Document that ran out of attempts, and raises the Source's Alert.
 *
 * One Alert per Source rather than per Document: a crawl that fails to extract
 * usually fails for every page, and forty Alerts saying the same thing is a
 * worse signal than one saying "twelve Documents".
 */
export async function recordFailedExtraction(input: {
  db: Db;
  organizationId: string;
  collectionId: string;
  sourceId: string;
  documentPath: string;
  attempts: number;
  error: string;
}): Promise<void> {
  await input.db.recordMemoryExtraction({
    organizationId: input.organizationId,
    collectionId: input.collectionId,
    sourceId: input.sourceId,
    documentPath: input.documentPath,
    bodyHash: null,
    status: "failed",
    memoryCount: 0,
    capped: false,
    attempts: input.attempts,
    lastError: input.error.slice(0, 500),
    extractedAt: null,
  });
  await signalExtractionHealth(input.db, input.organizationId, input.sourceId);
}

/**
 * The Source's extraction Alert: raised while any of its Documents is failed,
 * cleared the moment none is. Called after every settled attempt, so a
 * recovery resolves it without anybody clicking, the way crawl failures do.
 */
export async function signalExtractionHealth(
  db: Db,
  organizationId: string,
  sourceId: string
): Promise<void> {
  try {
    const records = await db.listMemoryExtractions(sourceId);
    const failed = records.filter((row) => row.status === "failed");
    const key = alertKeys.memoryExtraction(sourceId);
    if (failed.length === 0) {
      await signalHealth(db, organizationId, { key, healthy: true });
      return;
    }
    const source = await db.getSource(sourceId);
    await signalHealth(db, organizationId, {
      key,
      healthy: false,
      alert: {
        type: "ingestion",
        title: `Memory extraction failed for ${source?.name ?? "a knowledge source"}`,
        detail:
          failed.length === 1
            ? `1 Document could not be read for memories: ${failed[0]!.lastError ?? "unknown error"}`
            : `${failed.length} Documents could not be read for memories. Most recent error: ${
                failed[0]?.lastError ?? "unknown error"
              }`,
      },
    });
  } catch (error) {
    // The Alert is a signal about a failure, not a second place to fail.
    console.error("[memory-extraction] health signal failed:", error);
  }
}

function recordBase(input: ExtractDocumentMemoriesInput) {
  return {
    organizationId: input.organizationId,
    collectionId: input.collectionId,
    sourceId: input.sourceId,
    documentPath: input.documentPath,
  };
}

/**
 * Every chunk of the Document, so a quote from its last page still resolves
 * to a chunk. Paged because the seam pages; almost always one round trip.
 */
async function listAllChunks(
  db: Db,
  documentId: string
): Promise<Array<{ id: string; text: string }>> {
  const pageSize = 500;
  const all: Array<{ id: string; text: string }> = [];
  for (let page = 1; ; page += 1) {
    const { items } = await db.listDocumentChunks(documentId, { page, pageSize });
    all.push(...items);
    if (items.length < pageSize) return all;
  }
}

/** The chunk a quote sits in, when one of them contains it. */
function chunkFor(
  quote: string,
  chunks: Array<{ id: string; text: string }>
): string | null {
  const needle = quote.replace(/\s+/g, " ").trim().toLowerCase();
  const match = chunks.find((chunk) =>
    chunk.text.replace(/\s+/g, " ").toLowerCase().includes(needle)
  );
  return match?.id ?? null;
}
