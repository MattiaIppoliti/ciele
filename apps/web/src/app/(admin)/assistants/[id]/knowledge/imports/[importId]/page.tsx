import { notFound } from "next/navigation";
import { assistantKnowledgeHref } from "@/lib/knowledge-mode";
import { OperationError, listApplicationImportDocumentsOp } from "@ciele/ops";
import { ApplicationImportDocumentsView } from "@/components/knowledge/application-import-documents-view";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import {
  applicationImportHref,
  applicationSourcePrefix,
  parseApplicationImportPage,
} from "@/lib/application-import-documents";

export const dynamic = "force-dynamic";

/**
 * The same level inside an Assistant's Knowledge section. Scoped by the
 * Import's Assistant links: an Import this Assistant does not answer from is
 * not found here, the way a sibling's Source is not.
 */
export default async function AssistantApplicationImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, importId } = await params;
  const page = parseApplicationImportPage(await searchParams);
  await requirePageMember();

  let result;
  try {
    result = await runOperation(listApplicationImportDocumentsOp, {
      importId,
      assistantId: id,
      page,
    });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") notFound();
    throw error;
  }

  return (
    <ApplicationImportDocumentsView
      applicationImport={result.applicationImport}
      rows={result.items}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      basePath={applicationImportHref(importId, id)}
      sourcePrefix={applicationSourcePrefix(id)}
      backHref={assistantKnowledgeHref(id, "application")}
      backLabel="Knowledge"
    />
  );
}
