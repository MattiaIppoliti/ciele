"use client";

import * as React from "react";
import { grabOffsetFor } from "@agent-hub/ui/resize-geometry";

import {
  resolveColumnWidths,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  columnWidthFor,
  columnWidthsKey,
  parseColumnWidths,
} from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import { useTableChange } from "./table-history";

/**
 * Resizable columns, the way a spreadsheet-shaped table has them: a handle on
 * each column's right border, a `<colgroup>` that owns the widths, and a
 * layout the reader's choice survives a reload.
 *
 * The table has to be `table-fixed` for any of it to hold. In `auto` layout
 * the browser re-measures against the content on every render and a width set
 * here is a suggestion it ignores, which is why `TableColGroup` is rendered
 * with `<Table fixed>` and not on its own.
 */

export interface TableColumnLayout {
  key: string;
  /** Starting width in px, and what a reset returns to. */
  width: number;
  /** Readable floor for initial fitting. Every data column shares the drag minimum. */
  min?: number;
  /** Above this the table becomes difficult to scan; defaults to the shared cap. */
  max?: number;
  /** A column that is never dragged: the checkbox gutter, the actions cell. */
  fixed?: boolean;
}

export interface ColumnWidths {
  widths: Record<string, number>;
  /** Props for one column's handle; absent on a fixed column. */
  handleFor: (key: string) => ColumnResizeHandleProps | undefined;
  /** The `<colgroup>`, which is what actually applies the widths. */
  colGroup: React.ReactNode;
}

/**
 * Widths for one table, remembered per browser under `tableId`.
 *
 * Storage is a per-viewer convenience and nothing more: it can throw in a
 * private window, come back empty after a clear, and hold a column a release
 * has since renamed, so every read goes through `parseColumnWidths` and every
 * write is wrapped. A table whose storage is unreadable simply starts from
 * its declared layout, which is the layout it shipped with.
 */
/**
 * The stored layouts, as an external store rather than component state.
 *
 * `localStorage` is not React state: the server has none, so a value read
 * during the first render hydrates a different table than the one the server
 * sent, and reading it in an effect that then calls `setState` is the
 * cascading render the compiler rejects. `useSyncExternalStore` is built for
 * exactly this shape: the server snapshot is "nothing stored", the client
 * re-reads after hydration, and two tables sharing a key stay in step.
 *
 * The cache is what makes the snapshot stable. `getSnapshot` must return the
 * same reference until something actually changes, and `localStorage.getItem`
 * returns a fresh string every call, which React reads as an endless change.
 */
const storeListeners = new Set<() => void>();
const storeCache = new Map<string, string | null>();

function readStore(key: string): string | null {
  if (!storeCache.has(key)) {
    try {
      storeCache.set(key, localStorage.getItem(key));
    } catch {
      // Private window, blocked site data, a thumbnail capture.
      storeCache.set(key, null);
    }
  }
  return storeCache.get(key) ?? null;
}

function writeStore(key: string, value: string): void {
  storeCache.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // The width still applies for this visit; it just will not persist.
  }
  for (const listener of storeListeners) listener();
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

/**
 * Widths for one table, remembered per browser under `tableId`.
 *
 * What comes back is treated as hostile: a person can edit it, it survives a
 * release that renamed a column, and it can be absent. `parseColumnWidths`
 * keeps only the columns this table still declares at widths a drag could
 * have produced, and everything else falls back to the declared layout.
 */
export function useColumnWidths(
  tableId: string,
  layout: readonly TableColumnLayout[]
): ColumnWidths {
  const key = columnWidthsKey(tableId);
  const [measurements, setMeasurements] = React.useState({ available: 0, actions: 0 });
  // Which column's grip is under the pointer. It lights the whole column,
  // not the header cell the grip lives in: the boundary being dragged is the
  // column's, and a lit header over eleven unlit rows points at the wrong
  // thing. The tint goes on the `<col>`, which paints behind every cell of
  // that column for free.
  const [active, setActive] = React.useState<string | null>(null);
  // The width under the pointer, while the pointer is still holding it.
  // Storage is where a layout *rests*, not the channel a drag runs through: a
  // `setItem` per pointermove is a synchronous write, plus a JSON encode and a
  // notification to every subscribed table, sixty times a second on the same
  // thread that has to paint the column moving.
  const [draft, setDraft] = React.useState<Record<string, number> | null>(null);
  const raw = React.useSyncExternalStore(
    subscribeStore,
    () => readStore(key),
    () => null
  );

  const stored = parseColumnWidths(
    raw,
    layout.map((column) => column.key)
  );
  const preferred: Record<string, number> = {};
  for (const column of layout) {
    preferred[column.key] =
      column.fixed || column.key === "actions" ? column.width : (stored[column.key] ?? column.width);
  }

  const responsiveLayout = layout.map((column) => ({
    ...column,
    fixed: column.fixed || column.key === "actions",
    width: column.key === "actions" && measurements.actions ? measurements.actions : preferred[column.key],
    min: MIN_COLUMN_WIDTH,
  }));
  // Fit only the initial layout. A user resize freezes all rendered widths.
  const initialLayout = responsiveLayout.map((column, index) => ({
    ...column,
    min: Math.max(MIN_COLUMN_WIDTH, layout[index]?.min ?? MIN_COLUMN_WIDTH, Math.min(column.width, 160)),
  }));
  const widths = draft ?? resolveColumnWidths(
    Object.keys(stored).length ? responsiveLayout : initialLayout,
    measurements.available,
    stored
  );

  const commit = (columnKey: string, width: number) => {
    setDraft(null);
    writeStore(key, JSON.stringify({ ...widths, [columnKey]: width }));
  };

  const handleFor = (
    columnKey: string
  ): ColumnResizeHandleProps | undefined => {
    const column = layout.find((c) => c.key === columnKey);
    if (!column || column.fixed || column.key === "actions") return undefined;
    return {
      label: columnKey,
      value: widths[columnKey],
      minWidth: responsiveLayout.find((entry) => entry.key === columnKey)?.min ?? MIN_COLUMN_WIDTH,
      maxWidth: column.max ?? MAX_COLUMN_WIDTH,
      onResize: (width) => setDraft({ ...widths, [columnKey]: width }),
      onCommit: (width) => commit(columnKey, width),
      onReset: () => commit(columnKey, column.width),
      resetWidth: column.width,
      onActive: (on: boolean) => setActive(on ? columnKey : null),
    };
  };

  const totalWidth = Object.values(widths).reduce((sum, width) => sum + width, 0);
  const measureColumns = React.useCallback((group: HTMLTableColElement | null) => {
    const table = group?.closest("table");
    const container = table?.parentElement;
    if (!table || !container) return;
    // Explicit table width prevents the browser from redistributing a drag.
    table.style.setProperty("--table-width", `${totalWidth}px`);
    const measure = () => {
      const actionCells = table.querySelectorAll("tbody tr > td:not([colspan]):last-child > div");
      for (const cell of actionCells) observer.observe(cell);
      // Measure controls rather than the allocated cell to avoid width feedback.
      // Keep the heading readable even when a row only offers one icon.
      const actions = Math.max(MIN_COLUMN_WIDTH, ...Array.from(actionCells, (cell) => {
        const controls = Array.from(cell.querySelectorAll<HTMLElement>("button, a"));
        return controls.reduce((sum, control) => sum + control.offsetWidth, 24)
          + Math.max(0, controls.length - 1) * 6;
      }));
      const available = container.clientWidth;
      setMeasurements((previous) => previous.available === available && previous.actions === actions ? previous : { available, actions });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const changes = new MutationObserver(measure);
    changes.observe(table, { childList: true, subtree: true });
    measure();
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [totalWidth]);

  const colGroup = (
    <colgroup ref={measureColumns} data-table-id={tableId}>
      {layout.map((column) => (
        <col
          key={column.key}
          data-column={column.key}
          data-fixed={column.fixed || column.key === "actions" || undefined}
          style={{ width: `${widths[column.key]}px` }}
          // Deliberately fainter than the 10%-white row divider it sits
          // under. At 10% the tint matched the dividers and the column came
          // out as one flat block with its rows erased; the point is to say
          // which column is about to move, not to redraw it.
          className={cn(
            "transition-colors",
            active === column.key && "bg-primary/[0.04]"
          )}
        />
      ))}
    </colgroup>
  );

  return { widths, handleFor, colGroup };
}

export interface ColumnResizeHandleProps {
  resetWidth?: number;
  /** Names the column in the handle's accessible label. */
  label: string;
  /** Current width in CSS pixels. */
  value: number;
  minWidth: number;
  maxWidth: number;
  /** Every move: what the column should render right now. */
  onResize: (width: number) => void;
  /** Release: the width to remember. One storage write per drag, not per move. */
  onCommit: (width: number) => void;
  /** Double-click: back to the width the table shipped with. */
  onReset: () => void;
  /** Lights this column while the grip is hovered or held. */
  onActive: (on: boolean) => void;
}

/**
 * The grip on a column's right border.
 *
 * On a fine pointer it is wider than it looks (8px of target around a 1px
 * line); coarse pointers get a wider target in the admin stylesheet. It
 * captures the pointer rather than
 * listening on `window`, so a drag that leaves the table or crosses an iframe
 * still ends. The width is applied on every move and *stored* once, on
 * release; there is no drag ghost, because a table that resizes under the
 * pointer is the feedback.
 *
 * The lit line runs the **whole** table, not the header cell it lives in.
 * The boundary being dragged is the column's, and a 44px segment of it
 * highlighted at the top of a twelve-row table points at the header rather
 * than at the thing that is about to move. The height is measured on
 * pointer-enter rather than held in a CSS variable, because it is only ever
 * needed while the line is visible, which is exactly when the measurement is
 * current.
 */
export function ColumnResizeHandle({
  resetWidth,
  label,
  value,
  minWidth,
  maxWidth,
  onResize,
  onCommit,
  onReset,
  onActive,
}: ColumnResizeHandleProps) {
  const commit = useTableChange(value, onCommit, "Resize " + label + " column");
  const descriptionId = React.useId();
  const grabOffset = React.useRef(0);
  const left = React.useRef(0);
  /** The last width the drag produced, so the release knows what to store. */
  const lastWidth = React.useRef<number | null>(null);
  const startWidth = React.useRef(value);
  const [dragging, setDragging] = React.useState(false);
  const [tableHeight, setTableHeight] = React.useState<number | null>(null);

  function enter(event: React.PointerEvent<HTMLSpanElement>) {
    onActive(true);
    measure(event);
  }

  function leave() {
    // A drag that wandered off the grip is still a drag; the column stays
    // lit until the pointer is released.
    if (!dragging) onActive(false);
  }

  function measure(event: React.PointerEvent<HTMLSpanElement>) {
    const cell = event.currentTarget.closest("th");
    const table = cell?.closest("table");
    if (!table || !cell) return;
    // From the top of the header cell to the foot of the last row.
    setTableHeight(
      table.getBoundingClientRect().bottom - cell.getBoundingClientRect().top
    );
  }

  function begin(event: React.PointerEvent<HTMLSpanElement>) {
    const cell = event.currentTarget.closest("th");
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    startWidth.current = value;
    left.current = rect.left;
    grabOffset.current = grabOffsetFor(rect.right, event.clientX);
    measure(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    // The header is also a sort/filter trigger; without this a drag that
    // starts on the border opens the popover on release.
    event.preventDefault();
    event.stopPropagation();
  }

  function move(event: React.PointerEvent<HTMLSpanElement>) {
    if (!dragging) return;
    const width = columnWidthFor({
      pointer: event.clientX,
      grabOffset: grabOffset.current,
      left: left.current,
      minWidth,
      maxWidth,
    });
    lastWidth.current = width;
    onResize(width);
  }

  function end(event: React.PointerEvent<HTMLSpanElement>) {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    onActive(false);
    // A press with no move has nothing to remember, and committing the
    // starting width would write a layout the reader never chose.
    if (lastWidth.current !== null) commit(lastWidth.current, startWidth.current);
    lastWidth.current = null;
  }

  return (
    <>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${label} column`}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={value}
        aria-describedby={descriptionId}
        tabIndex={0}
        data-slot="column-resize-handle"
        onFocus={() => onActive(true)}
        onBlur={() => onActive(false)}
        onKeyDown={(event) => {
          let nextWidth: number | undefined;
          const step = event.shiftKey ? 64 : 16;
          if (event.key === "ArrowRight") nextWidth = Math.min(maxWidth, value + step);
          else if (event.key === "ArrowLeft") {
            nextWidth = Math.max(minWidth, value - step);
          } else if (event.key === "Home") nextWidth = minWidth;
          else if (event.key === "End") nextWidth = maxWidth;
          if (nextWidth === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          onResize(nextWidth);
          commit(nextWidth);
        }}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => resetWidth === undefined ? onReset() : commit(resetWidth)}
        className="group/grip absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none justify-center"
      >
        {/* Taller than its parent, so it needs its own element: the grip keeps
            the header's height as a hit area, and this is what is seen. */}
        <span
          aria-hidden
          style={tableHeight ? { height: tableHeight } : undefined}
          // Two pixels, not one: at 1px the line is a hairline against the
          // cell borders it sits among, and the whole point is that it reads
          // as the boundary being moved rather than as another divider.
          className={cn(
            "pointer-events-none absolute top-0 w-0.5 rounded-full transition-colors",
            tableHeight === null && "h-full",
            dragging ? "bg-primary" : "bg-transparent group-hover/grip:bg-primary"
          )}
        />
      </span>
      <span
        id={descriptionId}
        className="sr-only"
      >
        Use the left and right arrow keys to resize this column. Hold Shift for
        larger steps. Home sets the minimum width.
      </span>
    </>
  );
}
