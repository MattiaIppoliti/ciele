import { ExternalLink } from "lucide-react";
import type { Source, SourceDocumentListItem } from "@agent-hub/core";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { KnowledgeBreadcrumb } from "@/components/knowledge/knowledge-breadcrumb";
import { ExtractMemoriesButton } from "@/components/knowledge/extract-memories-button";
import { SourceDocumentsTable } from "@/components/knowledge/source-documents-table";
import { SourceHeaderMenu } from "@/components/knowledge/source-header-menu";
import type { SourceDocumentsSearchParams } from "@/lib/source-documents";

/**
 * Level 2 of the knowledge drill-down (#927): one Source's Documents.
 *
 * One component behind two routes, the Library's and the Assistant editor's,
 * because the drill-down used to be written twice as two dialogs that had
 * already drifted apart. The header is server-rendered; the table below it is
 * a client component, because selection is state and sorting and paging stay
 * in the URL either way.
 */
export function SourceDocumentsView({
  source,
  documents,
  memoryCounts,
  total,
  pageSize,
  params,
  basePath,
  backHref,
  backLabel,
  assistantId,
  canEdit,
}: {
  source: Source;
  documents: SourceDocumentListItem[];
  /** Live memories per Document path (#932); absent reads as none. */
  memoryCounts: Record<string, number>;
  total: number;
  pageSize: number;
  params: SourceDocumentsSearchParams;
  /** This route's path, without search params: every link is built from it. */
  basePath: string;
  backHref: string;
  backLabel: string;
  /** Set inside the Assistant editor: the menu offers unlink beside delete. */
  assistantId?: string;
  /** Editors get the backfill lever (#933) and the header menu; a Viewer reads. */
  canEdit: boolean;
}) {
  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 px-6 pt-5 pb-4">
        <KnowledgeBreadcrumb
          crumbs={[
            { label: backLabel, href: backHref },
            { label: source.name },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold break-all">
                {source.name}
              </span>
              <CopyIdButton id={source.id} />
            </h1>
            {/* No kind badge. "Entire website" beside a row whose URL is
                right there, on a page reached from the Websites tab, is the
                third time the same fact is stated. */}
            <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span suppressHydrationWarning>
                Added {new Date(source.createdAt).toLocaleDateString()}
              </span>
              {source.config.url && (
                <a
                  href={source.config.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex max-w-96 items-center gap-1 truncate hover:underline"
                >
                  {source.config.url}
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              )}
            </p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 items-center gap-2">
              <ExtractMemoriesButton sourceId={source.id} />
              <SourceHeaderMenu
                source={source}
                assistantId={assistantId}
                afterRemoveHref={backHref}
              />
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 px-6 pb-6">
        <SourceDocumentsTable
          sourceId={source.id}
          documents={documents}
          memoryCounts={memoryCounts}
          total={total}
          pageSize={pageSize}
          params={params}
          basePath={basePath}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
