"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, RotateCcw } from "lucide-react";
import { EyeOff, Maximize2 } from "lucide-react";
import type { SourceDocumentListItem } from "@agent-hub/core";
import { sourceDocumentStatus, sourceDocumentStatusLabel } from "@agent-hub/core";
import { Badge, Button } from "@agent-hub/ui";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableColumnHeader } from "@/components/ui/table-column-header";
import {
  useColumnWidths,
  type TableColumnLayout,
} from "@/components/ui/table-columns";
import { TableOpenCell } from "@/components/ui/table-open-cell";
import { TableRowMenu } from "@/components/ui/table-menu";
import {
  SelectAllHead,
  SelectRowCell,
  TableBulkBar,
  useRowSelection,
} from "@/components/ui/table-selection";
import { TablePagination } from "@/components/ui/table-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { setDocumentsExcludedAction } from "@/app/actions";
import { toast } from "@/lib/toast";
import {
  relativeTimeLabel,
  sourceDocumentHref,
  sourceDocumentsPageHref,
  sourceDocumentsParamsHref,
  sourceDocumentTone,
  type SourceDocumentsSearchParams,
} from "@/lib/source-documents";

/**
 * Level 2 of the knowledge drill-down (#927): one Source's Documents, in the
 * console's table card, with the same header band, row rhythm and footer the
 * Library's own table has.
 *
 * Sorting and paging stay in the URL, so the reader can share the address and
 * the back button works. Selection is the one thing that is client state, and
 * it is what the checkbox column was drawn for and left disabled by: ticking
 * rows here excludes them from retrieval in one call, the bulk twin of the
 * switch on a single Document's page.
 */
export function SourceDocumentsTable({
  sourceId,
  documents,
  memoryCounts,
  total,
  pageSize,
  params,
  basePath,
  canEdit,
}: {
  sourceId: string;
  documents: SourceDocumentListItem[];
  /** Live memories per Document path (#932); absent reads as none. */
  memoryCounts: Record<string, number>;
  total: number;
  pageSize: number;
  params: SourceDocumentsSearchParams;
  /** This route's path, without search params: every link is built from it. */
  basePath: string;
  /** Editors get the checkbox column; a Viewer reads. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const selection = useRowSelection(documents.map((d) => d.id));
  const now = new Date();
  /** The sort and the filter live in the URL, so a header click navigates. */
  const direction = params.ascending ? "asc" : "desc";
  const go = (patch: Partial<SourceDocumentsSearchParams>) =>
    router.push(sourceDocumentsParamsHref(basePath, params, patch));

  const layout: TableColumnLayout[] = [
    ...(canEdit
      ? [{ key: "select", width: 44, fixed: true } as TableColumnLayout]
      : []),
    { key: "document", width: 520, min: 200 },
    { key: "memories", width: 120 },
    { key: "status", width: 140 },
    { key: "updated", width: 180 },
  ];
  const columns = useColumnWidths("source-documents", layout);

  /** One row, from the context menu. The bulk bar's call with a single id. */
  function setRowExcluded(documentId: string, excluded: boolean) {
    startTransition(async () => {
      try {
        await setDocumentsExcludedAction(sourceId, [documentId], excluded);
        toast.success(
          excluded
            ? "Excluded from retrieval."
            : "Restored. It is being indexed again."
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save that"
        );
      }
    });
  }

  function setExcluded(excluded: boolean) {
    const ids = selection.ids;
    startTransition(async () => {
      try {
        const { changed } = await setDocumentsExcludedAction(
          sourceId,
          ids,
          excluded
        );
        selection.clear();
        toast.success(
          excluded
            ? `${changed} ${changed === 1 ? "Document" : "Documents"} excluded from retrieval.`
            : `${changed} ${changed === 1 ? "Document is" : "Documents are"} being indexed again.`
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save that"
        );
      }
    });
  }

  return (
    <TableCard
      className={isPending ? "opacity-60" : undefined}
      footer={
        <TablePagination
          page={params.page}
          pageSize={pageSize}
          total={total}
          noun="Document"
          onPageChange={(page) =>
            router.push(sourceDocumentsPageHref(basePath, params, page))
          }
        />
      }
    >
      <TableBulkBar
        count={selection.count}
        noun="Document"
        onClear={selection.clear}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setExcluded(true)}
        >
          <EyeOff className="mr-1.5 size-4" /> Exclude from retrieval
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setExcluded(false)}
        >
          <RotateCcw className="mr-1.5 size-4" /> Restore
        </Button>
      </TableBulkBar>

      <Table fixed empty={documents.length === 0}>
        {columns.colGroup}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {canEdit && (
              <SelectAllHead
                state={selection.allState}
                onToggle={selection.toggleAll}
                disabled={documents.length === 0}
              />
            )}
            <TableColumnHeader
              label="Document"
              resize={columns.handleFor("document")}
              sort={{
                direction: params.sort === "title" ? direction : null,
                ascLabel: "A to Z",
                descLabel: "Z to A",
                onSort: (next) =>
                  go({ sort: "title", ascending: next === "asc" }),
                onClear: () => go({ sort: "" }),
              }}
            />
            <TableColumnHeader
              label="Memories"
              resize={columns.handleFor("memories")}
            />
            <TableColumnHeader
              label="Status"
              resize={columns.handleFor("status")}
              filter={{
                kind: "options",
                value: params.status,
                anyLabel: "Any status",
                options: [
                  { value: "ready", label: "Ready" },
                  { value: "pending", label: "Pending" },
                  { value: "excluded", label: "Excluded" },
                ],
                onChange: (value) =>
                  go({ status: value as SourceDocumentsSearchParams["status"] }),
              }}
            />
            <TableColumnHeader
              label="Updated"
              resize={columns.handleFor("updated")}
              sort={{
                direction: params.sort === "" ? direction : null,
                ascLabel: "Oldest first",
                descLabel: "Newest first",
                onSort: (next) =>
                  go({ sort: "", ascending: next === "asc" }),
              }}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={canEdit ? 5 : 4}
                className="hover:bg-transparent"
              >
                {/* The crawl activity card counts pages while this counts
                    Documents, and the two can be on screen together: one says
                    what is arriving, the other what is stored. */}
                <EmptyState
                  size="sm"
                  title="No Documents yet"
                  description="They appear as the crawl stores them."
                />
              </TableCell>
            </TableRow>
          )}
          {documents.map((document) => {
            const status = sourceDocumentStatus(document);
            return (
              <TableRowMenu
                key={document.id}
                title={document.title}
                onOpen={
                  canEdit ? () => selection.selectForMenu(document.id) : undefined
                }
                actions={[
                  {
                    label: "Open",
                    icon: Maximize2,
                    href: sourceDocumentHref(basePath, document.id, params),
                  },
                  {
                    label: "Copy ID",
                    icon: Copy,
                    onSelect: () => {
                      void navigator.clipboard?.writeText(document.id);
                      toast.success("ID copied.");
                    },
                  },
                  canEdit &&
                    (document.excluded
                      ? {
                          label: "Restore to retrieval",
                          icon: RotateCcw,
                          onSelect: () => setRowExcluded(document.id, false),
                        }
                      : {
                          label: "Exclude from retrieval",
                          icon: EyeOff,
                          onSelect: () => setRowExcluded(document.id, true),
                        }),
                ]}
              >
              <TableRow
                data-state={
                  selection.isSelected(document.id) ? "selected" : undefined
                }
              >
                {canEdit && (
                  <SelectRowCell
                    checked={selection.isSelected(document.id)}
                    onToggle={() => selection.toggle(document.id)}
                    label={document.title}
                  />
                )}
                <TableCell>
                  <TableOpenCell
                    href={sourceDocumentHref(basePath, document.id, params)}
                    label={document.title}
                  >
                    <Link
                      href={sourceDocumentHref(basePath, document.id, params)}
                      className="press-text block truncate font-medium hover:underline"
                    >
                      {document.title}
                    </Link>
                    {document.resourceUrl ? (
                      <a
                        href={document.resourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground block truncate text-xs"
                      >
                        {document.resourceUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground block truncate text-xs">
                        {document.path}
                      </span>
                    )}
                  </TableOpenCell>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {memoryCounts[document.path] ?? 0}
                </TableCell>
                <TableCell>
                  <Badge tone={sourceDocumentTone(status)}>
                    {sourceDocumentStatusLabel(status)}
                  </Badge>
                </TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={new Date(document.createdAt).toISOString()}
                  suppressHydrationWarning
                >
                  {relativeTimeLabel(document.createdAt, now)}
                </TableCell>
              </TableRow>
              </TableRowMenu>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}
