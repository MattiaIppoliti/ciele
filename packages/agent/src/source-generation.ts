import type { WebsiteSourceConfig } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/** The durable identity of one staged replacement of a Source's knowledge. */
export interface SourceGeneration {
  generationId: string;
  expectedActiveGenerationId: string;
  /** A retry resumed after the compare-and-swap but before terminal cleanup. */
  alreadyCommitted: boolean;
}

export interface SourceGenerationCheckpoint {
  generationId: string;
  expectedActiveGenerationId: string;
  cursor: string;
  ingestedPages: number;
}

/** The crawler adapter's durable progress, decoded in one place. */
export function sourceGenerationCheckpoint(
  config: WebsiteSourceConfig,
): SourceGenerationCheckpoint | null {
  return config.crawlIngestGenerationId &&
    config.crawlIngestExpectedGenerationId
    ? {
        generationId: config.crawlIngestGenerationId,
        expectedActiveGenerationId: config.crawlIngestExpectedGenerationId,
        cursor: config.crawlIngestCursor ?? "0",
        ingestedPages: config.crawlIngestedPages ?? 0,
      }
    : null;
}

/** Persist the identity and paging progress needed to resume this generation. */
export async function checkpointSourceGeneration(options: {
  db: Db;
  sourceId: string;
  config: WebsiteSourceConfig;
  generation: Pick<
    SourceGeneration,
    "generationId" | "expectedActiveGenerationId"
  >;
  cursor: string;
  ingestedPages: number;
}): Promise<WebsiteSourceConfig> {
  const config: WebsiteSourceConfig = {
    ...options.config,
    crawlIngestGenerationId: options.generation.generationId,
    crawlIngestExpectedGenerationId:
      options.generation.expectedActiveGenerationId,
    crawlIngestCursor: options.cursor,
    crawlIngestedPages: options.ingestedPages,
  };
  await options.db.updateSource(options.sourceId, { config });
  return config;
}

/** Remove only generation-owned progress after the visibility CAS succeeds. */
export function clearSourceGenerationCheckpoint(
  config: WebsiteSourceConfig,
): WebsiteSourceConfig {
  return {
    ...config,
    crawlIngestCursor: undefined,
    crawlIngestGenerationId: undefined,
    crawlIngestExpectedGenerationId: undefined,
    crawlIngestedPages: undefined,
  };
}

/**
 * Opens a fresh Source generation or reconstructs one persisted by an adapter.
 */
export async function openSourceGeneration(options: {
  db: Db;
  sourceId: string;
  resume?: Partial<Pick<
    SourceGeneration,
    "generationId" | "expectedActiveGenerationId"
  >> | null;
}): Promise<SourceGeneration> {
  const source = await options.db.getSource(options.sourceId);
  if (!source) throw new Error(`Source ${options.sourceId} not found`);
  const generationId = options.resume?.generationId ?? crypto.randomUUID();
  const expectedActiveGenerationId =
    options.resume?.expectedActiveGenerationId ?? source.activeGenerationId;
  return {
    generationId,
    expectedActiveGenerationId,
    alreadyCommitted: source.activeGenerationId === generationId,
  };
}

/**
 * Discards only this inactive generation. Cleanup is best-effort because an
 * inactive generation is unreachable and a later reaper can remove it.
 */
export async function discardSourceGeneration(options: {
  db: Db;
  sourceId: string;
  generation: Pick<SourceGeneration, "generationId">;
  onRetired?: (conceptIds: string[]) => Promise<void>;
}): Promise<string[]> {
  try {
    const retired = await options.db.deleteSourceKnowledgeGeneration(
      options.sourceId,
      options.generation.generationId,
    );
    await options.onRetired?.(retired);
    return retired;
  } catch {
    return [];
  }
}

/**
 * Atomically makes a complete generation visible, then retires the generation
 * it replaced. Cleanup never changes a successful cutover into a failure.
 */
export async function commitSourceGeneration(options: {
  db: Db;
  sourceId: string;
  generation: SourceGeneration;
  commitGeneration?: (input: {
    sourceId: string;
    expectedActiveGenerationId: string;
    generationId: string;
  }) => Promise<boolean>;
  preserveStagedOnFailure?: boolean;
  onRetired?: (conceptIds: string[]) => Promise<void>;
}): Promise<"committed" | "superseded"> {
  const { db, sourceId, generation, onRetired } = options;
  const discard = () =>
    options.preserveStagedOnFailure
      ? Promise.resolve([])
      : discardSourceGeneration({ db, sourceId, generation, onRetired });
  if (!generation.alreadyCommitted) {
    let committed: boolean;
    try {
      const commit =
        options.commitGeneration ??
        ((input: {
          sourceId: string;
          expectedActiveGenerationId: string;
          generationId: string;
        }) => db.commitSourceKnowledgeGeneration(input));
      committed = await commit({
        sourceId,
        expectedActiveGenerationId: generation.expectedActiveGenerationId,
        generationId: generation.generationId,
      });
    } catch (error) {
      await discard();
      throw error;
    }
    if (!committed) {
      await discard();
      return "superseded";
    }
  }

  try {
    const retired = await db.deleteSourceKnowledgeGeneration(
      sourceId,
      generation.expectedActiveGenerationId,
    );
    await onRetired?.(retired);
  } catch {
    // The active generation is already correct; a later reaper can clean up.
  }
  return "committed";
}

/**
 * Complete-replacement adapter over the same generation lifecycle used by a
 * paged crawl. Ownership is checked before staging and before cutover; a lost
 * lease can expose neither a partial generation nor another writer's rows.
 */
export async function replaceSourceGeneration(options: {
  db: Db;
  sourceId: string;
  persistNewSet: (generationId: string) => Promise<"persisted" | "aborted">;
  checkpoint?: () => Promise<boolean>;
  generation?: Partial<
    Pick<SourceGeneration, "generationId" | "expectedActiveGenerationId">
  >;
  commitGeneration?: (input: {
    sourceId: string;
    expectedActiveGenerationId: string;
    generationId: string;
  }) => Promise<boolean>;
  preserveStagedOnAbort?: boolean;
  onRetired?: (conceptIds: string[]) => Promise<void>;
  onCommitted?: () => Promise<void>;
}): Promise<"committed" | "aborted"> {
  const ownershipHeld = async () =>
    options.checkpoint ? options.checkpoint() : true;
  if (!(await ownershipHeld())) return "aborted";

  const generation = await openSourceGeneration({
    db: options.db,
    sourceId: options.sourceId,
    resume: options.generation,
  });
  const discard = () =>
    options.preserveStagedOnAbort
      ? Promise.resolve([])
      : discardSourceGeneration({
          db: options.db,
          sourceId: options.sourceId,
          generation,
          onRetired: options.onRetired,
        });

  try {
    if ((await options.persistNewSet(generation.generationId)) === "aborted") {
      await discard();
      return "aborted";
    }
  } catch (error) {
    await discard();
    throw error;
  }

  if (!(await ownershipHeld())) {
    await discard();
    return "aborted";
  }

  const cutover = await commitSourceGeneration({
    db: options.db,
    sourceId: options.sourceId,
    generation,
    commitGeneration: options.commitGeneration,
    preserveStagedOnFailure: options.preserveStagedOnAbort,
    onRetired: options.onRetired,
  });
  if (cutover !== "committed") return "aborted";
  await options.onCommitted?.();
  return "committed";
}
