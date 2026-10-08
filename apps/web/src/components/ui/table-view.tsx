"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { SortableHandle, SortableList } from "./sortable-list";
import { useTableOrder } from "./table-preferences";
import { GripVertical } from "lucide-react";
import { reconcileTableOrder, moveTableColumn, tableRangeContains, tableRangeSize, type TableCellRange } from "@/lib/table-view";
import { TableHistoryContext } from "./table-history";

export interface ColumnPosition {
  original: number;
  visual: number;
  movable: boolean;
  label: string;
}
export const CellPosition = React.createContext<ColumnPosition | null>(null);
interface RowInfo {
  id: string;
  index: number;
}
export const RowPosition = React.createContext<RowInfo | null>(null);
export const HeaderContext = React.createContext(false);
interface TableView {
  order: number[];
  fixed: number[];
  labels: string[];
  moveColumn: (from: number, to: number) => void;
  range: TableCellRange | null;
  setRange: React.Dispatch<React.SetStateAction<TableCellRange | null>>;
  beginSelection: () => void;
  reorderColumns: (next: string[]) => void;
  draggingColumn: number | null;
  animateColumns: boolean;
  beginColumnDrag: (column: number) => void;
  endColumnDrag: () => void;
}
export const TableViewContext = React.createContext<TableView | null>(null);

export function elementChildren(node: React.ReactNode): React.ReactNode[] {
  return React.isValidElement<{ children?: React.ReactNode }>(node)
    ? React.Children.toArray(node.props.children) : [];
}

/** Conditional groups (for example FAQ question + answer) are still individual cells. */
function cellChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((node) =>
    React.isValidElement<{ children?: React.ReactNode }>(node) && node.type === React.Fragment
      ? cellChildren(node.props.children) : [node]);
}

function readCellText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof Element) {
    if (node.matches('button, [aria-hidden="true"], a[aria-label^="Open "]')) return "";
    if (node.localName === "scritto-text") return node.getAttribute("aria-label") ?? "";
  }
  return Array.from(node.childNodes, readCellText).join("");
}

/** Reorder keyed React children, retaining native table layout and semantics. */
export function TableViewProvider({ children, empty, headingType, bodyType }: {
  children: React.ReactElement<{ children?: React.ReactNode }>;
  empty?: boolean;
  headingType: React.ElementType;
  bodyType: React.ElementType;
}) {
  const history = React.useContext(TableHistoryContext);
  const nodes = elementChildren(children);
  const group = nodes.find((node) => React.isValidElement(node) && node.type === "colgroup");
  const cols = elementChildren(group);
  const header = nodes.find((node) => React.isValidElement(node) && node.type === headingType);
  const headings = cellChildren(elementChildren(elementChildren(header)[0]));
  const rowSignature = JSON.stringify(elementChildren(nodes.find((node) => React.isValidElement(node) && node.type === bodyType))
    .map((node) => React.isValidElement(node) ? node.key : null));
  const labels = cols.length ? cols.map((node, index) =>
    React.isValidElement<{ "data-column"?: string }>(node)
      ? node.props["data-column"] ?? String(index + 1) : String(index + 1))
    : headings.map((_, index) => String(index + 1));
  const fixed = cols.flatMap((node, index) =>
    React.isValidElement<{ "data-fixed"?: boolean; "data-column"?: string }>(node)
    && (node.props["data-fixed"] || node.props["data-column"] === "select" || node.props["data-column"] === "actions")
      ? [index] : []);
  const pathname = usePathname();
  const preferenceId = pathname + ":" + (React.isValidElement<{ "data-table-id"?: string }>(group) ? group.props["data-table-id"] : labels.join("-"));
  const [savedColumns, saveColumns] = useTableOrder(preferenceId);
  const [draggingColumn, setDraggingColumn] = React.useState<number | null>(null);
  const [animateColumns, setAnimateColumns] = React.useState(false);
  const movable = reconcileTableOrder(savedColumns, labels.filter((_, index) => !fixed.includes(index)));
  let cursor = 0;
  const order = labels.map((_, index) => fixed.includes(index) ? index : labels.indexOf(movable[cursor++]));
  const [selection, setSelection] = React.useState<{ signature: string; range: TableCellRange | null } | null>(null);
  const range = selection?.signature === rowSignature ? selection.range : null;
  const setRange: React.Dispatch<React.SetStateAction<TableCellRange | null>> = (next) => {
    setSelection((previous) => ({ signature: rowSignature, range: typeof next === "function"
      ? next(previous?.signature === rowSignature ? previous.range : null) : next }));
  };
  const startRange = React.useRef<TableCellRange | null>(null);
  const selecting = React.useRef(false);
  const moveColumn = (from: number, to: number) => {
    const next = moveTableColumn(order, from, to, fixed);
    if (next.every((key, index) => key === order[index])) return;
    const apply = (order: number[]) => { setAnimateColumns(false); saveColumns(order.filter((index) => !fixed.includes(index)).map((index) => labels[index])); setRange(null); };
    apply(next);
    history?.record({ label: "Move column", undo: () => apply(order), redo: () => apply(next) });
  };
  const finishSelection = () => {
    if (!selecting.current) return;
    selecting.current = false;
    const before = startRange.current;
    if (JSON.stringify(before) !== JSON.stringify(range)) {
      history?.record({ label: "Select cells", undo: () => setRange(before), redo: () => setRange(range) });
    }
  };
  const columnDragStart = React.useRef<number[] | null>(null);
  const applyColumns = (next: number[], animate = false) => { setAnimateColumns(animate); saveColumns(next.filter((index) => !fixed.includes(index)).map((index) => labels[index])); setRange(null); };
  const view: TableView = { order, fixed, labels, moveColumn, range, setRange, draggingColumn, animateColumns,
    reorderColumns: (next) => {
      const keys = next.map(Number).filter((key) => !fixed.includes(key));
      let i = 0;
      applyColumns(order.map((key) => fixed.includes(key) ? key : keys[i++]), true);
    },
    beginColumnDrag: (column) => { columnDragStart.current = order; setDraggingColumn(column); setAnimateColumns(true); },
    endColumnDrag: () => {
      setDraggingColumn(null);
      const before = columnDragStart.current; columnDragStart.current = null;
      if (before && before.some((key, index) => key !== order[index])) history?.record({ label: "Move column", undo: () => applyColumns(before), redo: () => applyColumns(order) });
    },
    beginSelection: () => { startRange.current = range; selecting.current = true; } };
  const count = tableRangeSize(range);
  return (
    <TableViewContext value={view}>
      <div data-slot="table-container"
        className="relative w-full overflow-x-auto rounded-3xl border bg-table-sheet shadow-light"
        onPointerUp={finishSelection} onPointerLeave={finishSelection}
        onCopy={(event) => {
          if (!range || !(event.target instanceof HTMLElement)
            || event.target.closest("input, textarea, [contenteditable=true]")) return;
          const rows = Array.from(event.currentTarget.querySelectorAll<HTMLTableRowElement>("tbody tr"));
          const text = rows.slice(Math.min(range.anchor.row, range.focus.row), Math.max(range.anchor.row, range.focus.row) + 1)
            .map((row) => Array.from(row.cells)
              .slice(Math.min(range.anchor.column, range.focus.column), Math.max(range.anchor.column, range.focus.column) + 1)
              .map((cell) => { const value = cell.querySelector("[data-table-value]"); return value ? readCellText(value).trim().replace(/\s+/g, " ") : ""; })
              .join("\t")).join("\n");
          event.clipboardData.setData("text/plain", text);
          event.preventDefault();
        }}>
        {React.cloneElement(children, {}, nodes.map((node) =>
          React.isValidElement<{ children?: React.ReactNode }>(node) && node.type === "colgroup"
            ? React.cloneElement(node, {}, order.map((index) => cols[index])) : node))}
      </div>
      {!empty && range && <div data-slot="table-view-footer" aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground">
        <span>{count + (count === 1 ? " value selected" : " values selected")}</span>
      </div>}
    </TableViewContext>
  );
}

/** Keep the result order supplied by sorting and pagination; identify rows for cell selection. */
export function TableRowsProvider({ children, ...props }: React.ComponentProps<"tbody">) {
  const nodes = React.Children.toArray(children);
  return <tbody {...props}>
    {nodes.map((node, index) => {
      const id = React.isValidElement(node) ? String(node.key) : String(index);
      return <RowPosition key={id} value={{ id, index }}>{node}</RowPosition>;
    })}
  </tbody>;
}

export function TableColumnsGroup({ children, ...props }: React.ComponentProps<"tr">) {
  const view = React.useContext(TableViewContext);
  return <SortableList as="tr" axis="x" values={view?.order.map(String) ?? []} onReorder={(next) => view?.reorderColumns(next)} {...props}>{children}</SortableList>;
}

export function TableCellsProvider({ children }: { children: React.ReactNode }) {
  const view = React.useContext(TableViewContext);
  const cells = cellChildren(children);
  const spanned = cells.some((cell) => React.isValidElement<{ colSpan?: number }>(cell) && (cell.props.colSpan ?? 1) > 1);
  const order = !spanned && view?.order.length === cells.length ? view.order : cells.map((_, index) => index);
  return order.map((original, visual) => (
    <CellPosition key={original} value={{ original, visual,
      movable: !spanned && Boolean(view) && !view?.fixed.includes(original),
      label: view?.labels[original] ?? String(original + 1) }}>
      {cells[original]}
    </CellPosition>
  ));
}

export function ColumnDragHandle() {
  const position = React.useContext(CellPosition);
  const view = React.useContext(TableViewContext);
  if (!position?.movable) return null;
  return <SortableHandle data-slot="column-drag-handle"
    aria-label={"Move " + position.label + " column"} title="Drag to move column. Alt + arrow keys to move."
    onKeyDown={(event) => {
      if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key) || !view) return;
      event.preventDefault();
      const movable = view.order.filter((key) => !view.fixed.includes(key));
      const target = movable[movable.indexOf(position.original) + (event.key === "ArrowLeft" ? -1 : 1)];
      if (target !== undefined) view.moveColumn(position.original, target);
    }}
    className="press-control touch-none -ml-1 inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 hover:bg-alpha-light hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing">
    <GripVertical aria-hidden="true" className="pointer-events-none size-4" />
  </SortableHandle>;
}

export function useCellSelection(spanned: boolean) {
  const position = React.useContext(CellPosition);
  const row = React.useContext(RowPosition);
  const view = React.useContext(TableViewContext);
  const point = row && position ? { row: row.index, column: position.visual } : null;
  const selected = point ? tableRangeContains(view?.range ?? null, point) : false;
  const focus = point && view?.range?.focus.row === point.row && view.range.focus.column === point.column;
  const selectable = Boolean(point && position?.movable && !spanned);
  return {
    dragging: Boolean(position && view?.draggingColumn === position.original),
    selected, focus, selectable,
    onPointerDown: (event: React.PointerEvent<HTMLTableCellElement>) => {
      if (event.defaultPrevented || event.button !== 0 || !selectable || !point || !view) return;
      if (event.target instanceof Element && event.target.closest("a, button, input, textarea, select, [role=checkbox], [role=switch], [contenteditable=true]")) return;
      view.beginSelection();
      view.setRange({ anchor: event.shiftKey && view.range ? view.range.anchor : point, focus: point });
      event.currentTarget.focus({ preventScroll: true });
      if (event.pointerType === "mouse") event.preventDefault();
    },
    onPointerEnter: (event: React.PointerEvent<HTMLTableCellElement>) => {
      if (event.buttons === 1 && selectable && point && event.pointerType === "mouse") {
        view?.setRange((range) => range ? { ...range, focus: point } : range);
      }
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLTableCellElement>) => {
      if (event.defaultPrevented || event.target !== event.currentTarget || !point || !view) return;
      if (event.key === "Escape") { view.setRange(null); return; }
      const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!vertical && !horizontal) return;
      event.preventDefault();
      const table = event.currentTarget.closest("table");
      const rows = Array.from(table?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []);
      const target = rows[point.row + vertical]?.cells[point.column + horizontal];
      if (!target || target.tabIndex < 0) return;
      target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", inline: "nearest" });
      const next = { row: point.row + vertical, column: point.column + horizontal };
      view.setRange({ anchor: event.shiftKey && view.range ? view.range.anchor : next, focus: next });
    },
  };
}
