import { listApplicationImportDocumentsOp } from "@ciele/ops";
import { ApplicationImportDocumentsView } from "@/components/knowledge/application-import-documents-view";
import { requirePageMember } from "@/lib/authz";
import { runPageOperation } from "@/lib/operations";
import {
  applicationImportHref,
  parseApplicationImportDocumentsParams,
  applicationSourcePrefix,
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
  const options = parseApplicationImportDocumentsParams(await searchParams);
  await requirePageMember();

  const result = await runPageOperation(listApplicationImportDocumentsOp, { importId, ...options });

  return (
    <ApplicationImportDocumentsView
      applicationImport={result.applicationImport}
      rows={result.items}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      fileTypes={result.fileTypes}
      mimeType={options.mimeType}
      basePath={applicationImportHref(importId)}
      sourcePrefix={applicationSourcePrefix()}
      backHref="/library/applications"
      backLabel="Library"
    />
  );
}
