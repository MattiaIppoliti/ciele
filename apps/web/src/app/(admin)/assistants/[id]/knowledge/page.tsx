import { notFound } from "next/navigation";
import { KnowledgeClient } from "@/components/assistant/knowledge-client";
import { SharedKnowledgePanel } from "@/components/assistant/shared-knowledge-panel";
import { requirePageMember } from "@/lib/authz";
import {
  KNOWLEDGE_TAB_KINDS,
  KNOWLEDGE_TAB_SLUGS,
  assistantScopedKnowledge,
  sharedAssistantNames,
} from "@/lib/knowledge-hub";
import { websiteCrawlerCapabilities } from "@agent-hub/agent";
import { getAssistantCached } from "../get-assistant";

/**
 * Bounded so one heavily shared Organization cannot flood the page. The same
 * read feeds the read-only "Shared knowledge" list (capped for display) and
 * the per-Source linked-assistant map the delete buttons need, so the limit
 * has to cover this Assistant's whole link set rather than one screenful.
 */
const LINKED_SOURCE_LIMIT = 200;
const SHARED_KNOWLEDGE_LIMIT = 50;

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { id } = await params;
  const { c } = await searchParams;
  const { db, organizationId } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  // "This assistant's collections" is derived membership (PRD #726 contract):
  // the Collections holding Sources linked to it. A fresh assistant has none,
  // so the org Knowledge Library is the add-flow target, the first add links
  // this assistant, and the Library starts appearing in the derived list.
  // (Viewers without insert rights keep the empty state via the catch.)
  const collections = await db.listCollections(id);
  const fallback =
    collections.length === 0
      ? await db
          .getOrCreateOrgLibraryCollection(organizationId)
          .catch(() => null)
      : null;
  const selectable = fallback ? [fallback] : collections;

  const selected =
    selectable.find((collection) => collection.id === c) ??
    selectable[0] ??
    null;
  // Scope by the LINK set, not the Collection (#733/#741): Collections are
  // org-owned, so the selected one can hold Sources this assistant never
  // answers from, showing (or letting an editor delete) those here would put
  // another assistant's knowledge in this editor.
  const [linkedSourceIds, collectionSources, collectionConcepts] = selected
    ? await Promise.all([
        db.listAssistantSourceIds(id),
        db.listSources(selected.id),
        db.listConcepts(selected.id),
      ])
    : [[], [], []];
  const { sources, concepts } = assistantScopedKnowledge({
    linkedSourceIds,
    sources: collectionSources,
    concepts: collectionConcepts,
  });
  // Retrieval follows the assistant-source links (PRD #726), so the page
  // shows every linked Source. The tabs above manage the ones in the selected
  // Collection; everything else linked to this assistant is listed read-only
  // below, so nothing it answers from is invisible here.
  const linkedItems =
    (
      await db
        .listOrgKnowledgeSources(organizationId, {
          kinds: KNOWLEDGE_TAB_SLUGS.flatMap(
            (slug) => KNOWLEDGE_TAB_KINDS[slug]
          ),
          assistantId: id,
          page: 1,
          pageSize: LINKED_SOURCE_LIMIT,
        })
        .catch(() => null)
    )?.items ?? [];
  const linkedElsewhere = linkedItems
    .filter((item) => item.collectionId !== selected?.id)
    .slice(0, SHARED_KNOWLEDGE_LIMIT);
  const nullEmbeddingCount = (
    await db.listNullEmbeddingConceptIds(id).catch(() => [])
  ).length;
  const crawlerCapabilities = websiteCrawlerCapabilities();

  return (
    <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        The knowledge this assistant answers from. Sources belong to the
        organization and reach this assistant through a link, managed here or
        in the Library; each one is indexed into concepts an answer can cite.
      </p>
      <KnowledgeClient
        assistantId={id}
        selected={selected}
        sources={sources}
        concepts={concepts}
        sharedWith={sharedAssistantNames(id, linkedItems)}
        crawl4aiAvailable={crawlerCapabilities.crawl4aiConfigured}
        apifyAvailable={crawlerCapabilities.apifyConfigured}
        nullEmbeddingCount={nullEmbeddingCount}
      />
      <SharedKnowledgePanel items={linkedElsewhere} />
    </div>
  );
}
