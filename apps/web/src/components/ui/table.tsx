"use client";

import { SortableItem } from "./sortable-list";
import * as React from "react";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { cn } from "@/lib/utils";
import { countLabel } from "@/lib/pagination";
import { RollInText } from "@/components/motion/roll-in-text";
import { TableHistoryContext, useTableHistory } from "./table-history";
import {
  HeaderContext, ColumnDragHandle, TableViewProvider,
  TableRowsProvider, TableCellsProvider, TableColumnsGroup, RowPosition, CellPosition, TableViewContext, useCellSelection,
} from "./table-view";

/** Shared tray, sheet and history for every console table. */
function TableCard({
  footer, title, results, filters, className, children, onKeyDown, ...props
}: Omit<React.ComponentProps<"div">, "title" | "results"> & {
  footer?: React.ReactNode;
  title?: React.ReactNode;
  results?: { total: number; noun: string; pluralNoun?: string };
  filters?: React.ReactNode;
}) {
  const history = useTableHistory();
  return (
    <TableHistoryContext value={history}>
      <div data-slot="table-card" role="region" aria-label={typeof title === "string" ? title : "Results"}
        className={cn("@container/table-card bg-table-frame relative flex w-full flex-col rounded-3xl border",
          "[&>[data-slot=table-container]]:order-1 [&>[data-slot=table-bulk-bar]]:order-2 [&>[data-slot=table-view-footer]]:order-3 [&>[data-slot=table-card-footer]]:order-4", className)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return;
          if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]")) return;
          if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
            event.preventDefault();
            if (event.shiftKey || event.key.toLowerCase() === "y") history.redo();
            else history.undo();
          }
        }} {...props}>
        <div data-slot="table-toolbar" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 @3xl/table-card:grid-cols-[minmax(8rem,1fr)_auto_auto]">
          <div className="min-w-0" data-slot="table-results">
            <p className="text-muted-foreground text-xs font-medium">Total Results</p>
            <p className="mt-0.5 text-sm font-medium">
              {results ? <RollInText entrance={false} text={countLabel(results.total, results.noun, results.pluralNoun)} /> : title ?? "Results"}
            </p>
          </div>
          {filters && <div data-slot="table-filters" className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 @3xl/table-card:col-span-1 @3xl/table-card:col-start-2 @3xl/table-card:row-start-1 @3xl/table-card:justify-end">{filters}</div>}
          <div data-slot="table-history" role="group" aria-label="Table history" className="col-start-2 row-start-1 flex items-center gap-1 @3xl/table-card:col-start-3">
            <Button variant="ghost" size="icon" aria-label="Undo table change"
              title={history.undoLabel ? "Undo: " + history.undoLabel : "Undo table change"}
              disabled={!history.undoLabel} onClick={history.undo}><Undo2 className="size-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Redo table change"
              title={history.redoLabel ? "Redo: " + history.redoLabel : "Redo table change"}
              disabled={!history.redoLabel} onClick={history.redo}><Redo2 className="size-4" /></Button>
          </div>
        </div>
        {children}
        {/* The sheet already has a rounded border; a full-width footer rule squares its lower corners. */}
        {footer && <div data-slot="table-card-footer" className="px-2">{footer}</div>}
      </div>
    </TableHistoryContext>
  );
}

function Table({ className, fixed, empty, ...props }: React.ComponentProps<"table"> & {
  fixed?: boolean;
  empty?: boolean;
}) {
  const history = React.useContext(TableHistoryContext);
  const sheet = (
    <TableViewProvider empty={empty} headingType={TableHeader} bodyType={TableBody}>
      <table role="table" data-slot="table" data-empty={empty ? "true" : undefined}
        className={cn(
          "w-[var(--table-width,100%)] caption-bottom text-sm",
          "[&:has(col[data-column=actions])_td:not([colspan]):last-child>div]:w-max [&:has(col[data-column=actions])_td:not([colspan]):last-child>div]:ml-auto",
          "[&_td:not(:last-child)]:border-r [&_th:not(:last-child)]:border-r",
          "data-[empty=true]:w-full data-[empty=true]:[&_col]:!w-auto data-[empty=true]:[&_thead]:hidden",
          fixed && "table-fixed", className,
        )} {...props} />
    </TableViewProvider>
  );
  const body = React.Children.toArray(props.children).find((child) => React.isValidElement(child) && child.type === TableBody);
  const total = !empty && React.isValidElement<{ children?: React.ReactNode }>(body) ? React.Children.toArray(body.props.children).length : 0;
  return history ? sheet : <TableCard title={props["aria-label"]} results={{ total, noun: "result" }}>{sheet}</TableCard>;
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <HeaderContext value={true}>
    <thead role="rowgroup" data-slot="table-header" className={cn("[&_tr>*]:bg-table-sheet", className)} {...props} />
  </HeaderContext>;
}

function TableBody({ className, children, ...props }: React.ComponentProps<"tbody">) {
  return <TableRowsProvider role="rowgroup" data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props}>{children}</TableRowsProvider>;
}

function TableRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  const row = React.useContext(RowPosition);
  const header = React.useContext(HeaderContext);
  const rowProps = { role: "row", "data-slot": "table-row", "data-table-row-id": row?.id,
    className: cn("group/row border-b transition-colors [&>*]:bg-table-sheet [&>*]:transition-colors",
      "hover:[&>*]:bg-accent has-aria-expanded:[&>*]:bg-accent data-[state=selected]:[&>*]:bg-ring/5", className), ...props };
  const cells = <TableCellsProvider>{children}</TableCellsProvider>;
  if (header) return <TableColumnsGroup {...rowProps}>{cells}</TableColumnsGroup>;
  return <tr {...rowProps}>{cells}</tr>;
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  const position = React.useContext(CellPosition);
  const view = React.useContext(TableViewContext);
  const headProps = { role: "columnheader", "data-slot": "table-head",
    "data-table-column-index": position?.movable ? position.original : undefined,
    "data-column-dragging": position && view?.draggingColumn === position.original || undefined,
    className: cn("text-muted-foreground relative h-12 px-4 text-left align-middle text-sm font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0", className), ...props };
  const value = <div data-table-value className={cn("flex items-center gap-2", className?.includes("text-right") && "justify-end")}>
    <ColumnDragHandle />{children}
  </div>;
  if (position?.movable) return <SortableItem as="th" value={String(position.original)} animateLayout={view?.animateColumns} {...headProps} onDragStart={() => view?.beginColumnDrag(position.original)} onDragEnd={view?.endColumnDrag}>{value}</SortableItem>;
  return <th {...headProps}>{value}</th>;
}

function TableCell({ className, children, onPointerDown, onPointerEnter, onKeyDown, onDoubleClick, onEdit, ...props }: React.ComponentProps<"td"> & { onEdit?: () => void }) {
  const selection = useCellSelection((props.colSpan ?? 1) > 1);
  return <td role="cell" data-slot="table-cell"
    data-cell-selected={selection.selected || undefined} data-cell-focus={selection.focus || undefined}
    data-column-dragging={selection.dragging || undefined}
    data-cell-editable={onEdit ? "true" : undefined}
    tabIndex={selection.selectable || onEdit ? 0 : undefined}
    onDoubleClick={(event) => {
      onDoubleClick?.(event);
      if (!event.defaultPrevented && !(event.target instanceof Element && event.target.closest("a, button, input, textarea, select, [role=checkbox], [role=switch]"))) onEdit?.();
    }}
    onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented) selection.onPointerDown(event); }}
    onPointerEnter={(event) => { onPointerEnter?.(event); if (!event.defaultPrevented) selection.onPointerEnter(event); }}
    onKeyDown={(event) => { onKeyDown?.(event);
      if (!event.defaultPrevented && event.target === event.currentTarget && onEdit && ["Enter", "F2"].includes(event.key)) { event.preventDefault(); onEdit(); }
      if (!event.defaultPrevented) selection.onKeyDown(event); }}
    className={cn(
      "relative overflow-hidden text-ellipsis px-4 py-3.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 outline-none",
      "data-[cell-selected=true]:!bg-ring/5 data-[cell-focus=true]:shadow-[inset_0_0_0_2px_var(--ring)] focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]",
      className,
    )} {...props}>
    <div data-table-value>{children}</div>
  </td>;
}

function TableActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-actions"
      className={cn(
        "flex items-center justify-end gap-1.5",
        className,
      )}
      {...props}
    />
  );
}

export { Table, TableActions, TableCard, TableHeader, TableBody, TableHead, TableRow, TableCell };
