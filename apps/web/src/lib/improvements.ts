import type { ComponentType } from "react";
import { ChartNoAxesColumnIncreasing, MoreHorizontal } from "lucide-react";
import type {
  Improvement,
  ImprovementListItem,
  ImprovementPriority,
  ImprovementStatus,
} from "@agent-hub/core";
import { IMPROVEMENT_STATUS_VALUES } from "@agent-hub/core";

type IconType = ComponentType<{ className?: string }>;

const IMPROVEMENT_STATUS_LABELS: Record<ImprovementStatus, string> = {
  to_do: "To do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  archived: "Archived",
};

/** Kanban lanes, in the board order `core` fixes; only the labels live here. */
export const IMPROVEMENT_STATUSES: Array<{
  value: ImprovementStatus;
  label: string;
}> = IMPROVEMENT_STATUS_VALUES.map((value) => ({
  value,
  label: IMPROVEMENT_STATUS_LABELS[value],
}));

export const IMPROVEMENT_PRIORITIES: Array<{
  value: ImprovementPriority;
  label: string;
  /** Tailwind classes for the priority chip. */
  chip: string;
  /** Bar-graph icon (dots for "none"), matching the reference picker. */
  icon: IconType;
  /** Icon tint. */
  iconColor: string;
}> = [
  {
    value: "high",
    label: "High",
    chip: "bg-red-100 text-red-700",
    icon: ChartNoAxesColumnIncreasing,
    iconColor: "text-red-600",
  },
  {
    value: "medium",
    label: "Medium",
    chip: "bg-amber-100 text-amber-700",
    icon: ChartNoAxesColumnIncreasing,
    iconColor: "text-amber-600",
  },
  {
    value: "low",
    label: "Low",
    chip: "bg-blue-100 text-blue-700",
    icon: ChartNoAxesColumnIncreasing,
    iconColor: "text-blue-600",
  },
  {
    value: "none",
    label: "None",
    chip: "bg-muted text-muted-foreground",
    icon: MoreHorizontal,
    iconColor: "text-muted-foreground",
  },
];

/**
 * True when a click on an improvement link should stay a navigation (new tab,
 * new window, download) instead of opening the drawer in place.
 */
export function keepsLinkNavigation(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/** Rows the board asks for per lane, first page and every "Load more". */
export const IMPROVEMENT_LANE_PAGE_SIZE = 50;

export interface ImprovementLanePage {
  items: ImprovementListItem[];
  nextCursor: string | null;
}

/** One entry per lane; the server renders the first page of each. */
export type ImprovementLanePages = Record<ImprovementStatus, ImprovementLanePage>;

export function emptyLaneRecord<T>(make: () => T): Record<ImprovementStatus, T> {
  return Object.fromEntries(
    IMPROVEMENT_STATUSES.map((lane) => [lane.value, make()]),
  ) as Record<ImprovementStatus, T>;
}

/**
 * How much of one lane the board holds: the smallest `seq` loaded in it
 * (`Infinity` when nothing is), and whether the loaded pages are the whole
 * lane (its cursor ran out). `mergeImprovementRows` reads these to tell a row
 * that fell onto an unloaded page from one the server no longer has.
 */
export interface ImprovementLaneWindow {
  floor: number;
  exhausted: boolean;
}

export type ImprovementLaneWindows = Record<
  ImprovementStatus,
  ImprovementLaneWindow
>;

/** One copy per id, the one with the newest `updatedAt`. */
function freshestById(
  sources: ReadonlyArray<ReadonlyArray<ImprovementListItem>>,
): Map<string, ImprovementListItem> {
  const byId = new Map<string, ImprovementListItem>();
  for (const rows of sources) {
    for (const row of rows) {
      const current = byId.get(row.id);
      if (!current || row.updatedAt >= current.updatedAt) byId.set(row.id, row);
    }
  }
  return byId;
}

/**
 * The freshest copy of every row seen by the board, one per id, newest `seq`
 * first. Sources are the lanes' first pages, the pages "Load more" appended
 * and the rows `retainPushedOffRows` kept; a row can sit in several of them
 * after a lane change, and `updatedAt` decides which copy is current. A
 * mutation result in `updates` wins over any copy it is not older than, so a
 * row on page three shows the status the server just confirmed for it.
 *
 * When no source carries the row at all, the update seeds it only if the row
 * can legitimately be outside every loaded window of its target lane: the
 * lane has pages nobody loaded and the row's `seq` is below the loaded floor.
 * A card dropped into a lane whose first page is full of newer rows lands
 * exactly there, and the confirmed result is the one copy the board holds.
 * When the lane is exhausted, or the `seq` sits inside the loaded range, a
 * page would carry the row if it existed; its absence means the server
 * deleted it, so the update is not seeded and its id comes back in `deleted`
 * for the board to forget. Without this an edited-then-deleted row came back
 * as a ghost card carrying a lane count the server never had.
 */
export function mergeImprovementRows(
  sources: ReadonlyArray<ReadonlyArray<ImprovementListItem>>,
  updates: Readonly<Record<string, ImprovementListItem>>,
  windows: Readonly<ImprovementLaneWindows>,
): { rows: ImprovementListItem[]; deleted: string[] } {
  const byId = freshestById(sources);
  const deleted: string[] = [];
  for (const [id, update] of Object.entries(updates)) {
    const current = byId.get(id);
    if (current) {
      if (update.updatedAt >= current.updatedAt) {
        byId.set(id, { ...current, ...update });
      }
      continue;
    }
    const lane = windows[update.status];
    if (!lane.exhausted && update.seq < lane.floor) byId.set(id, update);
    else deleted.push(id);
  }
  return { rows: [...byId.values()].sort((a, b) => b.seq - a.seq), deleted };
}

/**
 * A confirmed mutation result, stored as the list item `mergeImprovementRows`
 * reads. Two responses can resolve out of order, so an entry is replaced only
 * by a newer `updatedAt`, the same rule the merge applies against a server
 * row. The `messageCount` comes from the copy the board last showed, or from
 * the entry already stored; a row the board has never seen is not recorded,
 * because there is no honest count to give it and nothing to seed it from.
 */
export function recordImprovementUpdate(
  updates: Readonly<Record<string, ImprovementListItem>>,
  updated: Improvement,
  lastSeen: ImprovementListItem | undefined,
): Readonly<Record<string, ImprovementListItem>> {
  const previous = updates[updated.id];
  if (previous && previous.updatedAt > updated.updatedAt) return updates;
  const messageCount = lastSeen?.messageCount ?? previous?.messageCount;
  if (messageCount === undefined) return updates;
  return { ...updates, [updated.id]: { ...updated, messageCount } };
}

export interface ImprovementFilters {
  search: string;
  /** Empty string is "all priorities". */
  priority: ImprovementPriority | "";
  assignee: string;
}

/**
 * The board's search, priority and assignee filter, shared with the export so
 * the rows a filtered export writes are the rows the filtered board shows.
 * Search matches the title, the `IMP-n` key and the tags.
 */
export function matchesImprovementFilters(
  row: ImprovementListItem,
  filters: ImprovementFilters,
): boolean {
  const needle = filters.search.trim().toLowerCase();
  if (
    needle &&
    !row.title.toLowerCase().includes(needle) &&
    !improvementKey(row.seq).toLowerCase().includes(needle) &&
    !row.tags.some((tag) => tag.toLowerCase().includes(needle))
  ) {
    return false;
  }
  if (filters.priority && row.priority !== filters.priority) return false;
  if (filters.assignee && row.assigneeId !== filters.assignee) return false;
  return true;
}

/**
 * Rows a refreshed first page pushed off its end.
 *
 * Every mutation revalidates /improvements, so the lane's first page arrives
 * again from the server. When a new row landed in the lane meanwhile, the row
 * at the bottom of the old first page is now on the second, which the board
 * only holds if the reader already pressed "Load more". Without this it sits
 * in neither list and vanishes until a reload. Kept: rows from the previous
 * snapshot that the new page no longer carries, older than the new page's
 * last row and newer than anything "Load more" already fetched. Nothing is
 * kept when the page has no next cursor, because a lane that fits in one page
 * cannot have pushed anything off. A kept row that a colleague deleted or
 * moved in the same window lingers until the next reload; that is the trade.
 */
export function retainPushedOffRows(
  previous: ReadonlyArray<ImprovementListItem>,
  current: ImprovementLanePage,
  additional: ReadonlyArray<ImprovementListItem>,
): ImprovementListItem[] {
  if (current.nextCursor === null || current.items.length === 0) return [];
  const currentIds = new Set(current.items.map((row) => row.id));
  const floor = Math.min(...current.items.map((row) => row.seq));
  const ceiling =
    additional.length > 0
      ? Math.max(...additional.map((row) => row.seq))
      : Number.NEGATIVE_INFINITY;
  return [...freshestById([previous]).values()].filter(
    (row) => !currentIds.has(row.id) && row.seq < floor && row.seq > ceiling,
  );
}

/**
 * Lane sizes to show while a drag is in flight. The server counts are
 * authoritative and arrive fresh with every confirmed mutation (the action's
 * revalidation re-renders the page); only the optimistic overrides, cards
 * shown in a lane the server has not confirmed yet, move a count here.
 */
export function laneCountsWithOverrides(
  serverCounts: Readonly<Record<ImprovementStatus, number>>,
  rows: ReadonlyArray<ImprovementListItem>,
  shownIn: (row: ImprovementListItem) => ImprovementStatus,
): Record<ImprovementStatus, number> {
  const counts = { ...serverCounts };
  for (const row of rows) {
    const lane = shownIn(row);
    if (lane === row.status) continue;
    counts[row.status] -= 1;
    counts[lane] += 1;
  }
  return counts;
}

export function improvementKey(seq: number): string {
  return `IMP-${seq}`;
}

/**
 * Surface classes for the `IMP-n` key badge, tinted per status so the key alone
 * says where the item stands, no need to find which lane the row sits in. Only
 * "To do" stays neutral: it is the resting state, and tinting it would leave
 * nothing for the others to contrast against.
 */
export function improvementKeyClass(status: ImprovementStatus): string {
  switch (status) {
    case "in_progress":
      return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400";
    case "in_review":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "done":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "archived":
      return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400";
    default:
      return "bg-muted/50";
  }
}

export function statusLabel(status: ImprovementStatus): string {
  return IMPROVEMENT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function priorityMeta(priority: ImprovementPriority) {
  return (
    IMPROVEMENT_PRIORITIES.find((p) => p.value === priority) ??
    IMPROVEMENT_PRIORITIES[3]
  );
}
