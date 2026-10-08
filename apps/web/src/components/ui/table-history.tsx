"use client";

import * as React from "react";
import { TableViewHistory, type TableViewCommand } from "@/lib/table-view";

export interface TableHistoryControls {
  undoLabel?: string;
  redoLabel?: string;
  record: (command: TableViewCommand) => void;
  undo: () => void;
  redo: () => void;
}
export const TableHistoryContext = React.createContext<TableHistoryControls | null>(null);

export function useTableHistory(): TableHistoryControls {
  const [history] = React.useState(() => new TableViewHistory());
  const [, refresh] = React.useReducer((value: number) => value + 1, 0);
  return {
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
    record: (command) => { history.record(command); refresh(); },
    undo: () => { history.undo(); refresh(); },
    redo: () => { history.redo(); refresh(); },
  };
}

/** Commands use the current handler, so undo never restores stale neighbour state. */
export function useTableChange<T>(value: T, onChange: (next: T) => void, label: string): (next: T, before?: T) => void {
  const history = React.useContext(TableHistoryContext);
  const current = React.useRef(onChange);
  React.useLayoutEffect(() => { current.current = onChange; });
  return (next, before = value) => {
    onChange(next);
    if (Object.is(before, next)) return;
    history?.record({ label, undo: () => current.current(before), redo: () => current.current(next) });
  };
}
