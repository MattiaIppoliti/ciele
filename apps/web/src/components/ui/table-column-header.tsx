"use client";

import * as React from "react";
import { ArrowUp, ChevronsUpDown, Columns3, Search, X } from "lucide-react";
import { ArrowDown, Check } from "lucide-react";

import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import { TableHead } from "@/components/ui/table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";
import {
  ColumnResizeHandle,
  type ColumnResizeHandleProps,
} from "@/components/ui/table-columns";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import {
  pageSlice,
  sortRows,
  type ClientSort,
  type SortValue,
} from "@/lib/table-sort";
import { cn } from "@/lib/utils";

/**
 * A column header that does something when you click it.
 *
 * Every console table used to state its column and stop there: sorting was a
 * bare link on one header of one table, and filtering was a row of selects in
 * a toolbar above the card, disconnected from the column each one narrowed.
 * Both now live on the column, which is where the reader is already looking.
 *
 * The header owns no state. It is told this column's sort direction and
 * filter value and reports back, so a server-paged table can keep both in the
 * URL and a table that holds all its rows can keep them in React state. That
 * split matters: sorting the fifty rows on screen and calling it a sort is a
 * lie on a table with four more pages.
 */

export type ColumnSortDirection = "asc" | "desc";

export interface ColumnSort {
  /** This column's direction, or null when the table is sorted by another. */
  direction: ColumnSortDirection | null;
  onSort: (direction: ColumnSortDirection) => void;
  /** Clears the sort. Omit on a table that is always sorted by something. */
  onClear?: () => void;
  /** "A to Z" reads wrong on a date and "Oldest first" reads wrong on a name. */
  ascLabel?: string;
  descLabel?: string;
}

export type ColumnFilter =
  | {
      kind: "text";
      /** Empty means no filter. */
      value: string;
      placeholder?: string;
      onChange: (value: string) => void;
    }
  | {
      kind: "options";
      /** Empty means no filter, and is the first row of the list. */
      value: string;
      options: ReadonlyArray<{ value: string; label: string }>;
      onChange: (value: string) => void;
      /** The no-filter row's label, e.g. "Any status". */
      anyLabel: string;
    };

export function TableColumnHeader({
  label,
  sort,
  filter,
  resize,
  align = "left",
  className,
  ...props
}: Omit<React.ComponentProps<typeof TableHead>, "children"> & {
  label: React.ReactNode;
  sort?: ColumnSort;
  filter?: ColumnFilter;
  /** From `useColumnWidths(...).handleFor(key)`; absent means a fixed column. */
  resize?: ColumnResizeHandleProps;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const filtered = Boolean(filter?.value);
  const sorted = sort?.direction ?? null;

  /**
   * The same choices as the popover, as a right-click menu.
   *
   * Two ways in rather than one, because they are asked for differently: a
   * reader who knows the header is a control clicks it, and a reader coming
   * from a spreadsheet right-clicks the column. Both land on the same
   * handlers, so neither can drift from the other.
   */
  const menu = (head: React.ReactElement<React.HTMLAttributes<HTMLElement>>) => {
    if (!sort && !filter && !resize) return head;
    return (
      <ContextMenu>
        <ContextMenuTrigger>{head}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{label}</ContextMenuLabel>
          {sort && (
            <>
              <ContextMenuItem
                onSelect={() => sort.onSort("asc")}
                textValue={sort.ascLabel ?? "Sort ascending"}
              >
                <ArrowUp className="size-4 shrink-0" />
                {sort.ascLabel ?? "Sort ascending"}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => sort.onSort("desc")}
                textValue={sort.descLabel ?? "Sort descending"}
              >
                <ArrowDown className="size-4 shrink-0" />
                {sort.descLabel ?? "Sort descending"}
              </ContextMenuItem>
              {sort.onClear && sorted && (
                <ContextMenuItem
                  onSelect={() => sort.onClear?.()}
                  textValue="Clear sort"
                >
                  <X className="size-4 shrink-0" />
                  Clear sort
                </ContextMenuItem>
              )}
            </>
          )}

          {/* A text filter needs a field, and a menu is the wrong place for
              one: it opens the header's own popover with the field focused
              instead of growing a second input here. */}
          {filter?.kind === "text" && (
            <>
              {sort && <ContextMenuSeparator />}
              <ContextMenuItem
                onSelect={() => setOpen(true)}
                textValue="Filter"
              >
                <Search className="size-4 shrink-0" />
                {filter.value ? `Filter: ${filter.value}` : "Filter…"}
              </ContextMenuItem>
              {filter.value && (
                <ContextMenuItem
                  onSelect={() => filter.onChange("")}
                  textValue="Clear filter"
                >
                  <X className="size-4 shrink-0" />
                  Clear filter
                </ContextMenuItem>
              )}
            </>
          )}

          {filter?.kind === "options" && (
            <>
              {sort && <ContextMenuSeparator />}
              <ContextMenuRadioGroup
                value={filter.value}
                onValueChange={(next) => filter.onChange(next)}
              >
                <ContextMenuRadioItem value="" textValue={filter.anyLabel}>
                  {filter.anyLabel}
                </ContextMenuRadioItem>
                {filter.options.map((option) => (
                  <ContextMenuRadioItem
                    key={option.value}
                    value={option.value}
                    textValue={option.label}
                  >
                    {option.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </>
          )}

          {resize && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={resize.onReset}
                textValue="Reset column width"
              >
                <Columns3 className="size-4 shrink-0" />
                Reset column width
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  // A column that offers neither is still a column: it keeps the same type
  // and spacing so the header row does not go ragged where one is inert, and
  // it can still be resized.
  if (!sort && !filter) {
    return menu(
      <TableHead
        className={cn(align === "right" && "text-right", className)}
        {...props}
      >
        <span className="block truncate">{label}</span>
        {resize && <ColumnResizeHandle {...resize} />}
      </TableHead>
    );
  }

  return menu(
    <TableHead
      // No `overflow-hidden` here (which is what `truncate` would bring): the
      // resize line runs the height of the table and a clipping header cell
      // cuts it back to its own 44px. The label truncates inside instead.
      className={cn("group/th", align === "right" && "text-right", className)}
      aria-sort={
        sorted === "asc"
          ? "ascending"
          : sorted === "desc"
            ? "descending"
            : undefined
      }
      {...props}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                // No `max-w-full` or truncation here: inside a table cell it
                // makes the browser size the column to its minimum, and
                // "Linked assistants" came out as "Linked assist…".
                "press-text hover:text-foreground -mx-1.5 flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 whitespace-nowrap transition-colors",
                (sorted || filtered) && "text-foreground",
                align === "right" && "flex-row-reverse"
              )}
            />
          }
        >
          <span className="truncate">{label}</span>
          {/* The caret is the affordance, so it appears on hover and stays
              while the column is doing something. */}
          {sorted === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0" />
          ) : sorted === "desc" ? (
            <ArrowDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/th:opacity-50 group-focus-within/th:opacity-50" />
          )}
          {filtered && (
            <span
              aria-label="Filtered"
              className="bg-primary size-1.5 shrink-0 rounded-full"
            />
          )}
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1">
          {sort && (
            <div className="flex flex-col">
              <MenuItem
                icon={ArrowUp}
                selected={sorted === "asc"}
                onClick={() => {
                  sort.onSort("asc");
                  setOpen(false);
                }}
              >
                {sort.ascLabel ?? "Sort ascending"}
              </MenuItem>
              <MenuItem
                icon={ArrowDown}
                selected={sorted === "desc"}
                onClick={() => {
                  sort.onSort("desc");
                  setOpen(false);
                }}
              >
                {sort.descLabel ?? "Sort descending"}
              </MenuItem>
              {sort.onClear && sorted && (
                <MenuItem
                  icon={X}
                  onClick={() => {
                    sort.onClear?.();
                    setOpen(false);
                  }}
                >
                  Clear sort
                </MenuItem>
              )}
            </div>
          )}

          {sort && filter && <div className="bg-border my-1 h-px" />}

          {filter?.kind === "text" && (
            <div className="p-1">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  autoFocus
                  value={filter.value}
                  placeholder={filter.placeholder ?? "Contains…"}
                  onChange={(e) => filter.onChange(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              {filter.value && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full justify-start"
                  onClick={() => filter.onChange("")}
                >
                  <X className="mr-1.5 size-3.5" /> Clear filter
                </Button>
              )}
            </div>
          )}

          {filter?.kind === "options" && (
            <div className="flex max-h-64 flex-col overflow-y-auto">
              <MenuItem
                selected={filter.value === ""}
                onClick={() => {
                  filter.onChange("");
                  setOpen(false);
                }}
              >
                {filter.anyLabel}
              </MenuItem>
              {filter.options.map((option) => (
                <MenuItem
                  key={option.value}
                  selected={filter.value === option.value}
                  onClick={() => {
                    filter.onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </MenuItem>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {resize && <ColumnResizeHandle {...resize} />}
    </TableHead>
  );
}

function MenuItem({
  icon: Icon,
  selected,
  onClick,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-control hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal outline-none"
    >
      {Icon && <Icon className="text-muted-foreground size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="size-3.5 shrink-0" />}
    </button>
  );
}

/**
 * Sort state for a table that holds all of its rows.
 *
 * `column(key)` fills in one header's `sort` prop and `sorted(rows,
 * accessors)` applies the choice, so a caller writes the accessors once and
 * neither the header nor the body has to know which column is live.
 */
export function useClientSort(initial: ClientSort | null = null): {
  sort: ClientSort | null;
  column: (
    key: string,
    labels?: { asc?: string; desc?: string }
  ) => ColumnSort;
  sorted: <T>(
    rows: readonly T[],
    accessors: Record<string, (row: T) => SortValue>
  ) => T[];
} {
  const [sort, setSort] = React.useState<ClientSort | null>(initial);
  return {
    sort,
    column: (key, labels) => ({
      direction:
        sort?.key === key ? (sort.ascending ? "asc" : "desc") : null,
      ascLabel: labels?.asc,
      descLabel: labels?.desc,
      onSort: (next) => setSort({ key, ascending: next === "asc" }),
      onClear: () => setSort(null),
    }),
    sorted: (rows, accessors) => sortRows(rows, sort, accessors),
  };
}

/**
 * Paging for a table that holds all of its rows.
 *
 * It exists so those tables get the Library's footer rather than a bare
 * count: the same "Showing 1–25 of 61", the same rows-per-page control, the
 * same page arrows. The state is local because the rows are already here;
 * the Library keeps its own in the URL because its page is a database query.
 */
export function useClientPage<T>(rows: readonly T[]): {
  page: number;
  pageSize: number;
  items: T[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
} {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const slice = pageSlice(rows, page, pageSize);
  return {
    page: slice.page,
    pageSize,
    items: slice.items,
    onPageChange: setPage,
    onPageSizeChange: (size) => {
      setPageSize(size);
      setPage(1);
    },
  };
}
