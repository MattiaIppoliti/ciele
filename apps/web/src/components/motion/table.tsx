"use client";
// Source: https://beui.dev/components/motion/table (MIT)
//
// Ported down to the read-only surface this app needs: columns, sorting,
// loading skeletons and an empty state. Upstream's row virtualization
// (@tanstack/react-virtual), column resize/reorder, editable cells, row
// selection and the row handle menu are left out, no caller wants them and
// each pulls a dependency or a hook file. The prop names that survive keep
// upstream's spelling so re-adding a feature is an additive change.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { Skeleton } from "@agent-hub/ui";
import { cn } from "@/lib/utils";

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
  sortable?: boolean;
  align?: "left" | "center" | "right";
  /** Any CSS width ("30%", "12rem"); omit to share the leftover space. */
  width?: string;
  /** Hidden below `sm`, lets a wide table degrade instead of scrolling. */
  hideBelowSm?: boolean;
}

export interface TableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  getRowId?: (row: T, index: number) => string;
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  rowHeight?: number;
  loading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  className?: string;
}

function alignText(align: TableColumn<unknown>["align"]) {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

function readCell<T>(row: T, column: TableColumn<T>): ReactNode {
  if (column.cell) return column.cell(row);
  const value = column.accessor?.(row);
  return value == null ? "" : String(value);
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** Sort cycles asc -> desc -> unsorted, so a click can always undo itself. */
function nextSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

export function Table<T>({
  data,
  columns,
  getRowId,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  rowHeight = 56,
  loading = false,
  skeletonRows = 3,
  emptyState = "No data",
  className,
}: TableProps<T>) {
  const reduce = useReducedMotion();
  const [uncontrolledSort, setUncontrolledSort] = useState(defaultSort);
  const sort = sortProp !== undefined ? sortProp : uncontrolledSort;

  const toggleSort = useCallback(
    (key: string) => {
      const next = nextSort(sort, key);
      if (sortProp === undefined) setUncontrolledSort(next);
      onSortChange?.(next);
    },
    [sort, sortProp, onSortChange]
  );

  const rows = useMemo(
    () =>
      data.map((row, index) => ({
        row,
        id: getRowId ? getRowId(row, index) : String(index),
      })),
    [data, getRowId]
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.accessor) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort(
      (a, b) =>
        factor * compare(column.accessor!(a.row), column.accessor!(b.row))
    );
  }, [rows, columns, sort]);

  return (
    <div
      className={cn(
        "bg-card w-full overflow-hidden rounded-xl border",
        className
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <colgroup>
            {columns.map((column) => (
              <col
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
              />
            ))}
          </colgroup>

          <thead>
            <tr className="bg-muted/40 border-b">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    style={{ height: 40 }}
                    className={cn(
                      "text-muted-foreground px-4 text-xs font-medium",
                      alignText(column.align),
                      column.hideBelowSm && "hidden sm:table-cell"
                    )}
                  >
                    {column.sortable && column.accessor ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      >
                        {column.header}
                        <motion.span
                          aria-hidden
                          animate={{
                            opacity: active ? 1 : 0.25,
                            rotate: active && sort.direction === "desc" ? 180 : 0,
                          }}
                          transition={reduce ? { duration: 0 } : { duration: 0.18 }}
                          className="text-[10px] leading-none"
                        >
                          ▲
                        </motion.span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sortedRows.length === 0 ? (
              loading ? (
                <SkeletonRows
                  count={skeletonRows}
                  columns={columns}
                  rowHeight={rowHeight}
                />
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="text-muted-foreground p-10 text-center"
                  >
                    {emptyState}
                  </td>
                </tr>
              )
            ) : (
              <>
                {sortedRows.map((entry) => (
                  <tr
                    key={entry.id}
                    style={{ height: rowHeight }}
                    className="border-border/60 hover:bg-muted/50 border-b transition-colors last:border-b-0"
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "text-foreground px-4",
                          alignText(column.align),
                          column.hideBelowSm && "hidden sm:table-cell"
                        )}
                      >
                        {readCell(entry.row, column)}
                      </td>
                    ))}
                  </tr>
                ))}
                {loading ? (
                  <SkeletonRows
                    count={skeletonRows}
                    columns={columns}
                    rowHeight={rowHeight}
                  />
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkeletonRows<T>({
  count,
  columns,
  rowHeight,
}: {
  count: number;
  columns: TableColumn<T>[];
  rowHeight: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={`skeleton-${i}`} style={{ height: rowHeight }} className="border-b">
          {columns.map((column) => (
            <td
              key={column.key}
              className={cn("px-4", column.hideBelowSm && "hidden sm:table-cell")}
            >
              <Skeleton className="h-4 w-2/3" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
