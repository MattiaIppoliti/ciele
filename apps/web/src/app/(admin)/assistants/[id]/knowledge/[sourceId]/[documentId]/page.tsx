import { notFound } from "next/navigation";
import {
  OperationError,
  getSourceDocumentOp,
  listDocumentChunksOp,
  listDocumentMemoriesOp,
} from "@ciele/ops";
import { DocumentView } from "@/components/knowledge/document-view";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";
import { parseDocumentTab } from "@/lib/document-view";
import {
  assistantDocumentsHref,
  parseSourceDocumentsParams,
  sourceDocumentsPageHref,
  sourceDocumentsQuery,
} from "@/lib/source-documents";

export const dynamic = "force-dynamic";

/**
 * The same Document inside the Assistant editor (#928), scoped by the
 * Assistant↔Source link exactly as level 2 is.
 */
export default async function AssistantDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sourceId: string; documentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, sourceId, documentId } = await params;
  const search = await searchParams;
  const which = parseDocumentTab(search.tab);
  const openChunkId = typeof search.chunk === "string" ? search.chunk : undefined;
  // Where in the Documents table this row was opened from: the breadcrumb and
  // every tab link keep it, so "back" is the same page and sort (#928).
  const list = parseSourceDocumentsParams(search);
  const { role } = await requirePageMember();

  let view;
  let chunks;
  let memories;
  try {
    // The two tabs' data, read here so each paints with the route rather than
    // after a client round trip. Memories include the forgotten ones: the
    // toolbar's filter is the client's to apply, and a Member toggling it
    // should not wait for a request.
    //
    // Chunks are keyed by the ids in the URL, so that read does not wait for
    // the Document; only the memories do, because they are keyed by its
    // path. Awaiting all three in a row made opening a Document three
    // sequential round trips where two of them had nothing to say to each
    // other.
    [view, chunks] = await Promise.all([
      runOperation(getSourceDocumentOp, { sourceId, documentId, assistantId: id }),
      runOperation(listDocumentChunksOp, {
        sourceId,
        documentId,
        assistantId: id,
        page: 1,
      }),
    ]);
    memories = await runOperation(listDocumentMemoriesOp, {
      sourceId,
      documentPath: view.document.path,
      assistantId: id,
      includeForgotten: true,
    });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") notFound();
    throw error;
  }

  const sourcePath = assistantDocumentsHref(id, view.source.id);
  return (
    <DocumentView
      source={view.source}
      collection={view.collection}
      document={view.document}
      chunkCount={view.chunkCount}
      memoryCount={view.memoryCount}
      chunks={chunks.items}
      chunkPageSize={chunks.pageSize}
      memories={memories}
      extraction={view.extraction}
      queuedExtractions={view.queuedExtractions}
      openChunkId={openChunkId}
      assistantId={id}
      tab={which}
      basePath={`${sourcePath}/${view.document.id}`}
      backHref={sourceDocumentsPageHref(sourcePath, list, list.page)}
      rootHref={`/assistants/${id}/knowledge`}
      rootLabel="Knowledge"
      listQuery={sourceDocumentsQuery(list)}
      canEdit={canEdit(role)}
    />
  );
}
