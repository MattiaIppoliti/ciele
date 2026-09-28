import { notFound } from "next/navigation";
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
 * Level 2 for an Application Import, from the Library: every item the Import
 * brought in, each opening onto the Document route every Source already has.
 *
 * `imports` is a static segment, so it wins over the `[tab]` beside it and
 * never reads as a Library tab.
 */
export default async function LibraryApplicationImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { importId } = await params;
  const page = parseApplicationImportPage(await searchParams);
  await requirePageMember();

  let result;
  try {
    result = await runOperation(listApplicationImportDocumentsOp, { importId, page });
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
      basePath={applicationImportHref(importId)}
      sourcePrefix={applicationSourcePrefix()}
      backHref="/library/applications"
      backLabel="Library"
    />
  );
}
