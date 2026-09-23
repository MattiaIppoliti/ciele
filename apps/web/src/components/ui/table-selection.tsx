"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableHead } from "@/components/ui/table";
import { countLabel } from "@/lib/pagination";
import {
  selectAllState,
  selectForContextMenu,
  selectedRowIds,
  toggleAllRows,
  toggleRow,
  type SelectAllState,
} from "@/lib/table-selection";
import { cn } from "@/lib/utils";

/**
 * Multi-select for the console's tables: the leading checkbox column and the
 * bar the selection opens.
 *
 * One implementation, used by every table that offers it, so the column is
 * the same width, the header box means the same thing and the bar reads the
 * same wherever it appears. The arithmetic is in `lib/table-selection.ts`;
 * this file is the markup over it.
 */

export interface RowSelection {
  /** Selected rows, in the table's order, and already narrowed to what is on screen. */
  ids: string[];
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  /**
   * What a right-click on a row does: the menu acts on one row, so that row
   * becomes the selection unless it was already part of one.
   */
  selectForMenu: (id: string) => void;
  allState: SelectAllState;
  clear: () => void;
}

/**
 * Selection state for the rows currently rendered.
 *
 * Nothing is pruned when `rowIds` changes: every read intersects with it
 * instead, so paging away and back restores what was ticked while a bulk
 * action never reaches a row the reader cannot see.
 */
export function useRowSelection(rowIds: readonly string[]): RowSelection {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const ids = React.useMemo(
    () => selectedRowIds(selected, rowIds),
    [selected, rowIds]
  );
  return {
    ids,
    count: ids.length,
    isSelected: (id) => selected.has(id),
    toggle: (id) => setSelected((current) => toggleRow(current, id)),
    toggleAll: () => setSelected((current) => toggleAllRows(current, rowIds)),
    selectForMenu: (id) =>
      setSelected((current) => selectForContextMenu(current, id)),
    allState: selectAllState(selected, rowIds),
    clear: () => setSelected(new Set()),
  };
}

/** The header cell: select or clear every row on screen. */
export function SelectAllHead({
  state,
  onToggle,
  disabled,
}: {
  state: SelectAllState;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <TableHead className="w-10 pr-0">
      <Checkbox
        aria-label={state === "all" ? "Clear selection" : "Select all rows"}
        checked={state === "all"}
        indeterminate={state === "some"}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </TableHead>
  );
}

/** A row's cell. `label` names the row, so the box is not just "checkbox". */
export function SelectRowCell({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <TableCell className="w-10 pr-0">
      <Checkbox
        aria-label={`Select ${label}`}
        checked={checked}
        onCheckedChange={onToggle}
      />
    </TableCell>
  );
}

/**
 * The band that appears above the rows once something is ticked: what is
 * selected, the actions for it, and a way out.
 *
 * It sits inside the table card rather than floating over the page, because a
 * floating bar covers the last row of a short table and the reader then
 * cannot see what they are about to act on.
 */
export function TableBulkBar({
  count,
  noun,
  pluralNoun,
  onClear,
  className,
  children,
}: {
  count: number;
  /** Singular; the bar pluralises it, or uses `pluralNoun` where an "s" is wrong. */
  noun: string;
  pluralNoun?: string;
  onClear: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      data-slot="table-bulk-bar"
      // Rounded and rule-less, because it now sits on the card's frame rather
      // than inside the sheet: a band on the frame with a border under it
      // reads as a row of the table that lost its columns.
      className={cn(
        "bg-primary/10 mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-4 py-2 text-sm",
        className
      )}
    >
      <span className="font-medium">
        {countLabel(count, noun, pluralNoun)} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
