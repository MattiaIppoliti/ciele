import { notFound } from "next/navigation";
import { OperationError, listSourceDocumentsOp } from "@ciele/ops";
import { SourceDocumentsView } from "@/components/knowledge/source-documents-view";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { runOperation } from "@/lib/operations";
import { isKnowledgeTabSlug } from "@/lib/knowledge-hub";
import {
  libraryDocumentsHref,
  parseSourceDocumentsParams,
} from "@/lib/source-documents";

export const dynamic = "force-dynamic";

/**
 * Level 2 of the knowledge drill-down, from the Library (#927): one Source's
 * Documents as a route rather than the dialog this replaced.
 *
 * The tab is in the path, so the back button returns to the tab the reader came
 * from and the URL survives being shared. The breadcrumb goes back to that
 * tab, the one in the address, because "back" means where the reader was. The
 * links that walk further in are built from the Source's own kind, so a
 * hand-typed or stale tab is corrected on the next click rather than carried.
 */
export default async function LibrarySourceDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string; sourceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab, sourceId } = await params;
  if (!isKnowledgeTabSlug(tab)) notFound();
  const search = parseSourceDocumentsParams(await searchParams);
  const { role } = await requirePageMember();

  let page;
  try {
    page = await runOperation(listSourceDocumentsOp, {
      sourceId,
      page: search.page,
      ascending: search.ascending,
      sort: search.sort || undefined,
      status: search.status || undefined,
    });
  } catch (error) {
    // A Source in another Organization and a Source that never existed answer
    // the same way: the console does not confirm that someone else's row
    // exists. Anything else is a real failure and keeps being one.
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
      basePath={libraryDocumentsHref(page.source.kind, page.source.id)}
      backHref={`/library/${tab}`}
      canEdit={canEdit(role)}
      backLabel="Library"
    />
  );
}
