/** Retain saved preferences across filters/pages and append newly arrived rows. */
export function reconcileTableOrder(saved: readonly string[], available: readonly string[]): string[] {
  const present = new Set(available);
  const seen = new Set<string>();
  return [...saved, ...available].filter((id) => {
    if (!present.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Move one item without changing membership or the input array. */
export function moveTableItem<T>(items: readonly T[], from: T, to: T): T[] {
  const source = items.indexOf(from);
  const target = items.indexOf(to);
  if (source < 0 || target < 0 || source === target) return [...items];
  const next = [...items];
  next.splice(source, 1);
  next.splice(target, 0, from);
  return next;
}

/** Fixed gutters remain in their original slots. */
export function moveTableColumn(order: readonly number[], from: number, to: number, fixed: readonly number[]): number[] {
  if (fixed.includes(from) || fixed.includes(to)) return [...order];
  const movable = moveTableItem(order.filter((key) => !fixed.includes(key)), from, to);
  let index = 0;
  return order.map((key) => fixed.includes(key) ? key : movable[index++]);
}

export interface TableViewCommand {
  label: string;
  undo: () => void;
  redo: () => void;
}

/** Bounded, per-table history of reversible view changes. */
export class TableViewHistory {
  private past: TableViewCommand[] = [];
  private future: TableViewCommand[] = [];
  get undoLabel(): string | undefined { return this.past.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.future.at(-1)?.label; }
  record(command: TableViewCommand): void {
    this.past = [...this.past.slice(-49), command];
    this.future = [];
  }
  undo(): void {
    const command = this.past.at(-1);
    if (!command) return;
    command.undo();
    this.past.pop();
    this.future.push(command);
  }
  redo(): void {
    const command = this.future.at(-1);
    if (!command) return;
    command.redo();
    this.future.pop();
    this.past.push(command);
  }
}

export interface TableCellPoint { row: number; column: number }
export interface TableCellRange { anchor: TableCellPoint; focus: TableCellPoint }
export function tableRangeContains(range: TableCellRange | null, point: TableCellPoint): boolean {
  return Boolean(range && point.row >= Math.min(range.anchor.row, range.focus.row)
    && point.row <= Math.max(range.anchor.row, range.focus.row)
    && point.column >= Math.min(range.anchor.column, range.focus.column)
    && point.column <= Math.max(range.anchor.column, range.focus.column));
}
export function tableRangeSize(range: TableCellRange | null): number {
  return range ? (Math.abs(range.anchor.row - range.focus.row) + 1)
    * (Math.abs(range.anchor.column - range.focus.column) + 1) : 0;
}
