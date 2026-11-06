import { FAQ_DUPLICATE_THRESHOLD, faqDuplicateScore, type FaqDuplicate, type ProviderConnection } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { createEmbedder, embeddingSpaceId, type EmbeddingUsageContext } from "./embeddings";

/** One query embedding, then the existing Collection-scoped hybrid lookup. */
export async function findFaqDuplicates(input: { db: Db; connections: ProviderConnection[]; organizationId: string; collectionId: string; question: string; usage?: Pick<EmbeddingUsageContext, "spenders" | "surface"> }): Promise<FaqDuplicate[]> {
  const collection = await input.db.getCollection(input.collectionId);
  if (!collection || collection.organizationId !== input.organizationId) throw new Error("Collection not found");
  const embed = createEmbedder(input.connections, { db: input.db, organizationId: input.organizationId, assistantId: null, conversationId: null, ...input.usage });
  const embedding = await embed(input.question);
  const hits = await input.db.searchCollectionChunks(input.organizationId, [input.collectionId], { faqOnly: true, text: input.question, embedding, embeddingSpace: embeddingSpaceId(input.connections), limit: 30 });
  const seen = new Set<string>();
  const candidates: FaqDuplicate[] = [];
  for (const hit of hits) {
    if (!hit.sourceId || seen.has(hit.sourceId)) continue;
    const score = faqDuplicateScore(input.question, hit.conceptTitle, hit.similarity);
    if (score < FAQ_DUPLICATE_THRESHOLD) continue;
    const source = await input.db.getSource(hit.sourceId);
    if (!source || source.collectionId !== input.collectionId || source.kind !== "faq") continue;
    const concept = await input.db.getConcept(hit.conceptId);
    if (!concept || concept.sourceId !== source.id) continue;
    seen.add(source.id);
    candidates.push({ documentId: concept.id, sourceId: source.id, question: concept.frontmatter.title ?? hit.conceptTitle, answerPreview: concept.body.slice(0, 180), similarity: score });
  }
  return candidates.sort((a, b) => b.similarity - a.similarity || a.sourceId.localeCompare(b.sourceId)).slice(0, 3);
}
