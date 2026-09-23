import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import type {
  Concept,
  DocumentChunkListItem,
  KnowledgeCollection,
  KnowledgeMemory,
  KnowledgeMemoryExtraction,
  Source,
} from "@agent-hub/core";
import {
  memoriesEmptyState,
  nextCrawlDue,
  sourceDocumentStatus,
  sourceDocumentStatusLabel,
} from "@agent-hub/core";
import { Badge } from "@agent-hub/ui";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { DocumentChunks } from "@/components/knowledge/document-chunks";
import { KnowledgeBreadcrumb } from "@/components/knowledge/knowledge-breadcrumb";
import { DocumentContent } from "@/components/knowledge/document-content";
import { DocumentMemories } from "@/components/knowledge/document-memories";
import { DocumentExcludeToggle } from "@/components/knowledge/document-exclude-toggle";
import { DocumentSummaryCard } from "@/components/knowledge/document-summary-card";
import { sourceTypeLabel } from "@/lib/knowledge-hub";
import {
  DOCUMENT_TABS,
  documentExcerpt,
  documentOrigin,
  documentTabHref,
  type DocumentTab,
} from "@/lib/document-view";
import { contentHead } from "@/lib/document-content";
import {
  relativeTimeLabel,
  sourceDocumentTone,
} from "@/lib/source-documents";

/**
 * Level 3 of the knowledge drill-down (#928): one Document.
 *
 * Three tabs and a Details column, one component behind both routes for the
 * same reason as level 2. Tabs are links rather than state, so a tab is a URL
 * a reader can share and the back button steps through them.
 */
export function DocumentView({
  source,
  collection,
  document,
  chunkCount,
  memoryCount,
  chunks,
  chunkPageSize,
  memories,
  extraction,
  queuedExtractions,
  openChunkId,
  assistantId,
  tab,
  basePath,
  backHref,
  rootHref,
  rootLabel,
  listQuery = "",
  canEdit,
}: {
  source: Source;
  collection: KnowledgeCollection;
  document: Concept;
  chunkCount: number;
  memoryCount: number;
  /** The Chunks tab's first page, read on the server (#929). */
  chunks: DocumentChunkListItem[];
  chunkPageSize: number;
  /** Every memory of this page, forgotten ones included (#932). */
  memories: KnowledgeMemory[];
  /** The page's extraction record, which is why the tab is empty (#933). */
  extraction: KnowledgeMemoryExtraction | null;
  /** The ledger's view: a job waiting for this page, and how many for the Source. */
  queuedExtractions: { thisPage: boolean; source: number };
  /** From `?chunk=`: the chunk the Memories tab's Evidence asked to open. */
  openChunkId?: string;
  /** Set inside the Assistant editor, so the tab's own reads stay scoped. */
  assistantId?: string;
  tab: DocumentTab;
  basePath: string;
  /** Level 2, this Source's Documents, at the page and sort it was left on. */
  backHref: string;
  /**
   * Level 1, the Library tab or the Assistant's Knowledge section. Passed in
   * rather than derived, because the same Document has two homes and only
   * the route knows which one the reader came through.
   */
  rootHref: string;
  rootLabel: string;
  /** The Documents table's page and sort, kept on every link out of here. */
  listQuery?: string;
  canEdit: boolean;
}) {
  const title = document.frontmatter.title ?? document.path;
  const status = sourceDocumentStatus({
    excluded: document.excluded,
    indexed: chunkCount > 0,
  });
  const counts: Record<DocumentTab, number | null> = {
    memories: memoryCount,
    content: null,
    chunks: chunkCount,
  };
  const now = new Date();

  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 px-6 pt-5 pb-3">
        <KnowledgeBreadcrumb
          crumbs={[
            { label: rootLabel, href: rootHref },
            { label: source.name, href: backHref },
            { label: title },
          ]}
        />
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {title}
          <Badge tone={sourceDocumentTone(status)}>
            {sourceDocumentStatusLabel(status)}
          </Badge>
        </h1>
      </header>

      {/* Two cards side by side, as the reference lays it out: the tabs head
          the left card and their content fills it; Details and the Summary
          are cards of their own on the right, top-aligned with the tabs.
          Two columns from a 42rem container, so the right column is beside
          the tabs on any desktop and only a phone-width pane stacks it. */}
      <div className="grid min-h-0 flex-1 items-start gap-5 px-6 pt-2 pb-6 @2xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="bg-card min-w-0 rounded-xl border">
          <nav className="flex gap-1 border-b px-2" aria-label="Document views">
            {DOCUMENT_TABS.map((entry) => (
              <Link
                key={entry}
                href={documentTabHref(basePath, entry, listQuery)}
                aria-current={entry === tab ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm capitalize ${
                  entry === tab
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                {entry}
                {counts[entry] !== null && (
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    {counts[entry]}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <div className="min-w-0 p-4">
            {tab === "content" && (
              <div className="space-y-3">
                {source.originalObjectPath && (
                  <a
                    href={`/api/knowledge/originals/${encodeURIComponent(source.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:bg-accent press inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <Download className="size-4" />
                    Download original
                  </a>
                )}
                <DocumentContent
                  {...contentHead(document.body)}
                  sourceId={source.id}
                  documentId={document.id}
                  assistantId={assistantId}
                />
              </div>
            )}
            {tab === "memories" && (
              <DocumentMemories
                // Remount when the server's answer changes, so the refresh the
                // tab polls with while extracting replaces its local list.
                key={`${memories.length}:${extraction?.status ?? "none"}:${
                  extraction?.extractedAt ?? ""
                }:${queuedExtractions.source}`}
                sourceId={source.id}
                documentPath={document.path}
                collectionName={collection.name}
                initialMemories={memories}
                emptyState={memoriesEmptyState({
                  extraction,
                  nextCrawlAt: nextCrawlDue(
                    source.recrawlSchedule,
                    source.lastCrawledAt,
                  ),
                  queued: queuedExtractions,
                })}
                canEdit={canEdit}
                chunksHref={documentTabHref(basePath, "chunks", listQuery)}
              />
            )}
            {tab === "chunks" && (
              <DocumentChunks
                sourceId={source.id}
                documentId={document.id}
                assistantId={assistantId}
                initialChunks={chunks}
                total={chunkCount}
                pageSize={chunkPageSize}
                openChunkId={openChunkId}
              />
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="bg-card rounded-xl border">
            <h2 className="border-b px-4 py-3 text-sm font-medium">Details</h2>
            <div className="space-y-5 px-4 py-4">
              <DetailGroup label="Source">
                <DetailRow label="Collection">
                  <Badge variant="secondary">{collection.name}</Badge>
                </DetailRow>
                <DetailRow label="Source">
                  <Link href={backHref} className="press-text hover:underline">
                    {source.name}
                  </Link>
                </DetailRow>
                <DetailRow label="How it got here">
                  {documentOrigin(source.kind)}
                </DetailRow>
                {document.frontmatter.resource && (
                  <DetailRow label="Resource">
                    <a
                      href={document.frontmatter.resource}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex items-center gap-1 break-all hover:underline"
                    >
                      {document.frontmatter.resource}
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </DetailRow>
                )}
              </DetailGroup>

              <DetailGroup label="Identity">
                <DetailRow label="Document id">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono text-xs break-all">
                      {document.id}
                    </span>
                    <CopyIdButton id={document.id} />
                  </span>
                </DetailRow>
                <DetailRow label="Path">
                  <span className="font-mono text-xs break-all">
                    {document.path}
                  </span>
                </DetailRow>
                <DetailRow label="Type">
                  <span className="font-mono text-xs">
                    {document.frontmatter.type}
                  </span>
                </DetailRow>
                <DetailRow label="Source kind">
                  <span className="font-mono text-xs">
                    {sourceTypeLabel(source.kind)}
                  </span>
                </DetailRow>
              </DetailGroup>

              <DetailGroup label="Activity">
                <DetailRow label="Stored">
                  <span
                    className="font-mono text-xs"
                    title={new Date(document.createdAt).toISOString()}
                    suppressHydrationWarning
                  >
                    {relativeTimeLabel(document.createdAt, now)}
                  </span>
                </DetailRow>
                <DetailRow label="Chunks">
                  <span className="font-mono text-xs">{chunkCount}</span>
                </DetailRow>
                {canEdit ? (
                  <DocumentExcludeToggle
                    sourceId={source.id}
                    documentId={document.id}
                    excluded={document.excluded}
                  />
                ) : (
                  <DetailRow label="Excluded from retrieval">
                    <span className="font-mono text-xs">
                      {document.excluded ? "yes" : "no"}
                    </span>
                  </DetailRow>
                )}
              </DetailGroup>
            </div>
          </section>

          <DocumentSummaryCard
            sourceId={source.id}
            documentId={document.id}
            assistantId={assistantId}
            excerpt={documentExcerpt(document.body)}
            cachedSummary={document.summary}
          />
        </aside>
      </div>
    </div>
  );
}

function DetailGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        {label}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
