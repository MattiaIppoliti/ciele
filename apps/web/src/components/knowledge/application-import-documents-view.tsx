import type { ApplicationImport } from "@agent-hub/core";
import type { ApplicationImportDocumentRow } from "@ciele/ops";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { ApplicationImportDocumentsTable } from "@/components/knowledge/application-import-documents-table";
import { KnowledgeBreadcrumb } from "@/components/knowledge/knowledge-breadcrumb";
import { formatDay } from "@/lib/format";

/**
 * Level 2 for an Application Import, the twin of `SourceDocumentsView`: one
 * component behind the Library's route and the Assistant editor's.
 */
export function ApplicationImportDocumentsView({
  applicationImport,
  rows,
  total,
  page,
  pageSize,
  basePath,
  sourcePrefix,
  backHref,
  backLabel,
}: {
  applicationImport: ApplicationImport;
  rows: ApplicationImportDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  sourcePrefix: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 px-6 pt-5 pb-4">
        <KnowledgeBreadcrumb
          crumbs={[
            { label: backLabel, href: backHref },
            { label: applicationImport.name },
          ]}
        />
        <h1 className="flex flex-wrap items-center gap-2">
          <span className="text-2xl font-semibold break-all">
            {applicationImport.name}
          </span>
          <CopyIdButton id={applicationImport.id} />
        </h1>
        <p
          className="text-muted-foreground mt-1 text-sm"
          suppressHydrationWarning
        >
          Added {formatDay(applicationImport.createdAt)}
          {applicationImport.lastSyncedAt
            ? ` · Last synchronized ${formatDay(applicationImport.lastSyncedAt)}`
            : " · Not synchronized yet"}
        </p>
      </header>

      <div className="min-h-0 flex-1 px-6 pb-6">
        <ApplicationImportDocumentsTable
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          basePath={basePath}
          sourcePrefix={sourcePrefix}
        />
      </div>
    </div>
  );
}
