"use client";

// Source: https://beui.dev/components/motion/table (MIT).
// Adapted to the console's shared table controls.
import { TableEditableCell, type TableCellEditor } from "@/components/ui/table-editable-cell";
import { EmptyState } from "@/components/ui/empty-state";
import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useColumnWidths } from "@/components/ui/table-columns";
import { TableColumnHeader, useClientPage, useClientSort } from "@/components/ui/table-column-header";
import {
  Table as TableRoot,
  TableBody,
  TableCard,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableFilter, TableSearch } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { cn } from "@/lib/utils";
import { RollInText, RollRow } from "./roll-in-text";

export type SortDirection = "asc" | "desc";
export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  /** Read the raw value, used for sorting and as the default cell body. */
  accessor?: (row: T) => string | number | null | undefined;
  /** Render the cell. Falls back to `accessor`. */
  cell?: (row: T) => ReactNode;
  editor?: (row: T) => TableCellEditor | undefined;
  sortable?: boolean;
  filterOptions?: ReadonlyArray<{ value: string; label: string }>;
  filterLabel?: string;
  filterAnyLabel?: string;
  align?: "left" | "center" | "right";
  /** Any CSS width ("30%", "12rem"); omit to share the leftover space. */
  width?: string;
  /** Retained for compatibility; tables now scroll to keep every column available. */
  hideBelowSm?: boolean;
}

export interface TableProps<T> {
  title?: ReactNode;
  noun: string;
  pluralNoun?: string;
  searchValue?: (row: T) => string;
  data: T[];
  columns: TableColumn<T>[];
  getRowId: (row: T) => string;
  emptyState: ReactNode;
  filters?: ReactNode;
  searchable?: boolean;
  /** Server-paged tables supply their global count and URL navigation. */
  pagination?: ComponentProps<typeof TablePagination>;
  onRowClick?: (row: T) => void;
  isRowSelected?: (row: T) => boolean;
}

function alignText(align: TableColumn<unknown>["align"]) {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

function readCell<T>(row: T, column: TableColumn<T>): ReactNode {
  if (column.cell) return column.cell(row);
  const value = column.accessor?.(row);
  // A plain value rolls when it changes, and rolls in on the first rows.
  return value == null ? "" : <RollInText text={String(value)} />;
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function Table<T>({
  title,
  noun,
  pluralNoun,
  searchValue,
  data,
  columns,
  getRowId,
  emptyState,
  filters: toolbarFilters,
  searchable = true,
  pagination,
  onRowClick,
  isRowSelected,
}: TableProps<T>) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const order = useClientSort();
  const sort = order.sort;
  const layout = useColumnWidths("records-" + columns.map((column) => column.key).join("-"), columns.map((column) => ({
    key: column.key,
    width: column.width?.endsWith("rem") ? parseFloat(column.width) * 16
      : column.width?.endsWith("px") ? parseFloat(column.width) : 200,
    fixed: column.key === "actions",
  })));

  const filtered = useMemo(() => pagination ? data : data.filter((row) => {
    const text = searchValue?.(row) ?? columns.map((column) => column.accessor?.(row) ?? "").join(" ");
    return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && columns.every((column) =>
      !filters[column.key] || String(column.accessor?.(row)) === filters[column.key]);
  }), [data, columns, searchValue, query, filters, pagination]);
  const rows = useMemo(() => filtered.map((row) => ({ row, id: getRowId(row) })), [filtered, getRowId]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.accessor) return rows;
    const factor = sort.ascending ? 1 : -1;
    return [...rows].sort(
      (a, b) =>
        factor * compare(column.accessor!(a.row), column.accessor!(b.row))
    );
  }, [rows, columns, sort]);

  const paged = useClientPage(sortedRows);
  const resetQuery = (value: string) => { setQuery(value); paged.onPageChange(1); };

  return (
    <TableCard title={title} results={{ total: pagination?.total ?? filtered.length, noun, pluralNoun }}
      filters={<>
        {toolbarFilters}
        {columns.filter((column) => !pagination && column.filterOptions).map((column) => <TableFilter key={column.key}
          label={column.filterLabel ?? column.key} value={filters[column.key] ?? ""} anyLabel={column.filterAnyLabel ?? `All ${(column.filterLabel ?? column.key).toLowerCase()}s`}
          options={column.filterOptions!} onChange={(value) => { setFilters((previous) => ({ ...previous, [column.key]: value })); paged.onPageChange(1); }} />)}
        {!pagination && searchable && <TableSearch label={`Search ${pluralNoun ?? noun + "s"}`} value={query} onChange={resetQuery} />}
      </>}
      footer={<TablePagination page={paged.page} pageSize={paged.pageSize} total={filtered.length} noun={noun}
        onPageChange={paged.onPageChange} onPageSizeChange={paged.onPageSizeChange} {...pagination} />}>

      <TableRoot fixed empty={rows.length === 0}>
        {layout.colGroup}

        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableColumnHeader key={column.key} label={column.header}
                resize={layout.handleFor(column.key)}
                sort={!pagination && column.sortable && column.accessor ? order.column(column.key) : undefined}
                filter={!pagination && column.filterOptions ? { kind: "options", value: filters[column.key] ?? "", anyLabel: column.filterAnyLabel ?? `All ${(column.filterLabel ?? column.key).toLowerCase()}s`,
                  options: column.filterOptions, onChange: (value) => { setFilters((previous) => ({ ...previous, [column.key]: value })); paged.onPageChange(1); } } : undefined}
                align={column.align === "right" ? "right" : "left"}
                className={alignText(column.align)} />
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {sortedRows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="text-muted-foreground p-10 text-center"
              >
                {data.length > 0 ? <EmptyState size="sm" title="No matching results" description="Try another search or clear the filters." /> :
                  typeof emptyState === "string" ? <EmptyState size="sm" title="Nothing here yet" description={emptyState} /> : emptyState}
              </TableCell>
            </TableRow>
          ) : (
            (pagination ? sortedRows : paged.items).map((entry, index) => (
              <RollRow key={entry.id} index={index}>
              <TableRow
                style={{ height: 56 }}
                onClick={onRowClick ? () => onRowClick(entry.row) : undefined}
                data-state={isRowSelected?.(entry.row) ? "selected" : undefined}
                className={cn("border-border/60 last:border-b-0", onRowClick && "cursor-pointer")}
              >
                {columns.map((column) => (
                  <TableEditableCell
                    editor={column.editor?.(entry.row)}
                    key={column.key}
                    className={cn(
                      "text-foreground",
                      alignText(column.align),
                    )}
                  >
                    {readCell(entry.row, column)}
                  </TableEditableCell>
                ))}
              </TableRow>
              </RollRow>
            ))
          )}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
}
