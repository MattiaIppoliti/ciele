import { notFound } from "next/navigation";
import { OperationError, listSourceDocumentsOp } from "@ciele/ops";
import { SourceDocumentsView } from "@/components/knowledge/source-documents-view";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { runOperation } from "@/lib/operations";
import {
  assistantDocumentsHref,
  parseSourceDocumentsParams,
} from "@/lib/source-documents";

export const dynamic = "force-dynamic";

/**
 * The same level, inside an Assistant's Knowledge section (#927): the editor's
 * own chrome around the same component the Library renders.
 *
 * Scoped by the Assistant↔Source link, not by the Collection (#733): a Source
 * this Assistant does not answer from is not found here, even though the
 * Organization owns it and the Library shows it. The editor has no business
 * confirming that a sibling Assistant's knowledge exists.
 */
export default async function AssistantSourceDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sourceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, sourceId } = await params;
  const search = parseSourceDocumentsParams(await searchParams);
  const { role } = await requirePageMember();

  let page;
  try {
    page = await runOperation(listSourceDocumentsOp, {
      sourceId,
      assistantId: id,
      page: search.page,
      ascending: search.ascending,
      sort: search.sort || undefined,
      status: search.status || undefined,
    });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") notFound();
    throw error;
  }

  return (
    <SourceDocumentsView
      source={page.source}
      documents={page.items}
      memoryCounts={page.memoryCounts}
      total={page.total}
      pageSize={page.pageSize}
      params={search}
      basePath={assistantDocumentsHref(id, page.source.id)}
      backHref={`/assistants/${id}/knowledge`}
      canEdit={canEdit(role)}
      backLabel="Knowledge"
      assistantId={id}
    />
  );
}
