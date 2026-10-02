"use client";
import { StatusBadge as StatusPill, statusFromTone } from "@/components/spaceui/status-badge";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Maximize2 } from "lucide-react";
import type { ApplicationImportDocumentRow } from "@ciele/ops";

import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableColumnHeader } from "@/components/ui/table-column-header";
import { useColumnWidths, type TableColumnLayout } from "@/components/ui/table-columns";
import { TableOpenCell } from "@/components/ui/table-open-cell";
import { TableRowMenu } from "@/components/ui/table-menu";
import { TablePagination } from "@/components/ui/table-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/lib/toast";
import { relativeTimeLabel } from "@/lib/source-documents";
import {
  applicationImportPageHref,
  applicationImportRowHref,
  applicationImportRowStatusLabel,
  applicationImportRowTone,
} from "@/lib/application-import-documents";

/**
 * Level 2 of an Application Import: every item it brought in, in the same
 * table card, columns and row rhythm as a website's Documents, so crossing
 * from one to the other reads as the same place.
 *
 * Read-only on purpose. Excluding an item is a per-Document decision that the
 * Document's own page already offers; a bulk bar here would act across many
 * Sources at once, which no other table in the drill-down does.
 */
export function ApplicationImportDocumentsTable({
  rows,
  total,
  page,
  pageSize,
  basePath,
  sourcePrefix,
}: {
  rows: ApplicationImportDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  /** This route's path, without search params. */
  basePath: string;
  /** Where the Source routes live on this surface; rows append their ids. */
  sourcePrefix: string;
}) {
  const router = useRouter();
  const now = new Date();
  const layout: TableColumnLayout[] = [
    { key: "document", width: 520, min: 200 },
    { key: "memories", width: 120 },
    { key: "status", width: 140 },
    { key: "updated", width: 180 },
  ];
  const columns = useColumnWidths("application-import-documents", layout);

  return (
    <TableCard
      footer={
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          noun="Document"
          onPageChange={(next) => router.push(applicationImportPageHref(basePath, next))}
        />
      }
    >
      <Table fixed empty={rows.length === 0}>
        {columns.colGroup}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableColumnHeader label="Document" resize={columns.handleFor("document")} />
            <TableColumnHeader label="Memories" resize={columns.handleFor("memories")} />
            <TableColumnHeader label="Status" resize={columns.handleFor("status")} />
            <TableColumnHeader label="Updated" resize={columns.handleFor("updated")} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="hover:bg-transparent">
                <EmptyState
                  size="sm"
                  title="No Documents yet"
                  description="They appear as the import synchronizes them."
                />
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => {
            const href = applicationImportRowHref(sourcePrefix, row);
            return (
              <TableRowMenu
                key={row.sourceId}
                title={row.title}
                actions={[
                  { label: "Open", icon: Maximize2, href },
                  {
                    label: "Copy ID",
                    icon: Copy,
                    onSelect: () => {
                      void navigator.clipboard?.writeText(row.documentId ?? row.sourceId);
                      toast.success("ID copied.");
                    },
                  },
                ]}
              >
                <TableRow>
                  <TableCell>
                    <TableOpenCell href={href} label={row.title}>
                      <Link
                        href={href}
                        className="press-text block truncate font-medium hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.remoteUrl ? (
                        <a
                          href={row.remoteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                        >
                          Open in source application
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : row.documentCount > 1 ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {row.documentCount} Documents
                        </span>
                      ) : null}
                    </TableOpenCell>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.memoryCount}
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      status={statusFromTone(applicationImportRowTone(row.status))}
                      animated={row.status === "pending"}
                      primaryText={applicationImportRowStatusLabel(row.status)}
                    />
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={new Date(row.updatedAt).toISOString()}
                    suppressHydrationWarning
                  >
                    {relativeTimeLabel(row.updatedAt, now)}
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
