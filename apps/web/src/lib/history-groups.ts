/**
 * The date folders every conversation history in the console draws: the
 * widget's, the Preview's and the Chat sidebar's. Pure, so the one rule for
 * where a thread lands is tested once instead of per list.
 */

/** "Today" / "Yesterday" / "07 Jul 2025", in the viewer's local calendar. */
export function historyDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** The prefix a day folder's id carries, so a click on one never navigates. */
export const DAY_GROUP_PREFIX = "day:";

export interface DayGroup<T> {
  id: string;
  label: string;
  entries: T[];
}

/** Newest first, one group per calendar day, in the order the days occur. */
export function groupByDay<T extends { updatedAt: string }>(
  entries: readonly T[],
  now: Date = new Date()
): DayGroup<T>[] {
  const sorted = [...entries].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  const groups: DayGroup<T>[] = [];
  for (const entry of sorted) {
    const label = historyDayLabel(entry.updatedAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ id: `${DAY_GROUP_PREFIX}${label}`, label, entries: [entry] });
  }
  return groups;
}

/**
 * How long ago, as the history menu's right column says it: "Now", "25m",
 * "3h", "2d", then the day. Short on purpose, the row's title is the content.
 */
export function relativeShort(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
