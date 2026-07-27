import { notFound } from "next/navigation";
import { KnowledgeClient } from "@/components/assistant/knowledge-client";
import { requirePageMember } from "@/lib/authz";
import { websiteCrawlerCapabilities } from "@agent-hub/agent";
import { getAssistantCached } from "../get-assistant";

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { id } = await params;
  const { c } = await searchParams;
  const { db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  let collections = await db.listCollections(id);
  // Every Assistant gets a working knowledge area out of the box. Viewers
  // without insert rights keep the empty state.
  if (collections.length === 0) {
    try {
      await db.createCollection(id, {
        name: "General knowledge",
        description: "Default collection for this assistant",
      });
      collections = await db.listCollections(id);
    } catch {
      // Read-only Role.
    }
  }

  const selected =
    collections.find((collection) => collection.id === c) ??
    collections[0] ??
    null;
  const [sources, concepts] = selected
    ? await Promise.all([
        db.listSources(selected.id),
        db.listConcepts(selected.id),
      ])
    : [[], []];
  const nullEmbeddingCount = (
    await db.listNullEmbeddingConceptIds(id).catch(() => [])
  ).length;
  const crawlerCapabilities = websiteCrawlerCapabilities();

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        OKF collections powering this assistant&apos;s answers — sources are
        enriched into concept documents and indexed for retrieval.
      </p>
      <KnowledgeClient
        assistantId={id}
        selected={selected}
        sources={sources}
        concepts={concepts}
        crawl4aiAvailable={crawlerCapabilities.crawl4aiConfigured}
        apifyAvailable={crawlerCapabilities.apifyConfigured}
        nullEmbeddingCount={nullEmbeddingCount}
      />
    </div>
  );
}
