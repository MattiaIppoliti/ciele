import type { Db } from "@agent-hub/db";
import type { KnowledgeDocument } from "./types";

/**
 * Reading a Concept by id, with the tenancy check that makes it safe to let a
 * model name the id.
 *
 * The id the model supplies is checked against the reading Assistant's own
 * Knowledge Collections before anything is read: a Visitor's turn must never
 * reach another tenant's Concept by guessing. That check is the whole point of
 * this module, so it lives where it can be tested directly rather than only
 * through a full Conversation Turn, and a handover, which reads as its TARGET
 * Assistant, gets the same boundary from the same code.
 *
 * The Collection list is loaded at most once per reader, and only if the model
 * actually reads.
 */
export type KnowledgeDocumentReader = (
  id: string
) => Promise<KnowledgeDocument | null>;

/**
 * A factory per turn, a reader per Assistant. Each reader caches the
 * Collections of the one Assistant it was built for, so the cache can never
 * leak across the assistant boundary it is enforcing.
 */
export function createDocumentReaderFactory(
  db: Db
): (assistantId: string) => KnowledgeDocumentReader {
  return (assistantId: string) => {
    let collectionIds: Set<string> | null = null;
    return async (id: string): Promise<KnowledgeDocument | null> => {
      const documentId = id.trim();
      if (!documentId) return null;
      if (collectionIds === null) {
        const collections = await db.listCollections(assistantId);
        collectionIds = new Set(collections.map((c) => c.id));
      }
      const concept = await db.getConcept(documentId);
      if (!concept || !collectionIds.has(concept.collectionId)) return null;
      const source = concept.sourceId
        ? await db.getSource(concept.sourceId).catch(() => null)
        : null;
      return {
        id: concept.id,
        title: concept.frontmatter.title || concept.path,
        sourceName: source?.name ?? null,
        text: concept.body,
      };
    };
  };
}
