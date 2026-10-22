import {
  CalendarDate,
  endOfMonth,
  getDayOfWeek,
  parseDate,
  startOfMonth,
  startOfWeek,
  type DayOfWeek,
} from "@internationalized/date";
import type { Task } from "@agent-hub/core";
import { addDays, daysBetween } from "@agent-hub/core";
import { filtersFromSearchParams, type SearchParamsLike } from "@/lib/url-state";

/**
 * The date grids behind Calendar and Timeline (#1065), pure so they are tested.
 * Days are `YYYY-MM-DD` strings at the edges and `CalendarDate`s inside, so no
 * time zone ever moves a Task to the neighbouring day. Weeks start on Monday.
 */

const LOCALE = "en-GB";
const WEEK_START: DayOfWeek = "mon";

const day = (iso: string): CalendarDate => parseDate(iso);
const iso = (date: CalendarDate): string => date.toString();

/** Monday of the week holding `value`. */
export function weekStart(value: string): string {
  return iso(startOfWeek(day(value), LOCALE, WEEK_START));
}

/** 0 for Monday … 6 for Sunday. */
export function weekdayIndex(value: string): number {
  return getDayOfWeek(day(value), LOCALE, WEEK_START);
}

export function isWeekend(value: string): boolean {
  return weekdayIndex(value) >= 5;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** First of the month holding `value`. */
export function monthOf(value: string): string {
  return iso(startOfMonth(day(value)));
}

export function shiftMonth(value: string, months: number): string {
  return iso(startOfMonth(day(value)).add({ months }));
}

/**
 * A month as whole weeks: five rows when the month fits in them, six when its
 * last days spill into a sixth.
 */
export function monthGrid(month: string): string[] {
  const first = startOfMonth(day(month));
  const start = startOfWeek(first, LOCALE, WEEK_START);
  const last = endOfMonth(first);
  const cells = Array.from({ length: 42 }, (_, i) => start.add({ days: i }));
  const five = cells[34]!;
  return (five.compare(last) >= 0 ? cells.slice(0, 35) : cells).map(iso);
}

/** The seven days of the week holding `value`. */
export function weekGrid(value: string): string[] {
  const start = startOfWeek(day(value), LOCALE, WEEK_START);
  return Array.from({ length: 7 }, (_, i) => iso(start.add({ days: i })));
}

// Spelled out rather than asked of Intl: ICU builds disagree on "Sep" and
// "Sept", and a server and a browser that disagree is a hydration error.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (month: number) => MONTHS[month - 1]!.slice(0, 3);

/** "October 2026". */
export function monthLabel(month: string): string {
  const date = day(month);
  return `${MONTHS[date.month - 1]} ${date.year}`;
}

/** "Oct 2026". */
export function shortMonthLabel(month: string): string {
  const date = day(month);
  return `${short(date.month)} ${date.year}`;
}

/** "5 – 11 Oct 2026", or across a month "28 Sep – 4 Oct 2026". */
export function weekLabel(value: string): string {
  const days = weekGrid(value);
  const a = day(days[0]!);
  const b = day(days[6]!);
  const left = a.month === b.month ? `${a.day}` : `${a.day} ${short(a.month)}`;
  return `${left} – ${b.day} ${short(b.month)} ${b.year}`;
}

/**
 * Moving a Task to another day keeps its length: the start date travels with
 * the due date. A Task with no due date takes the day as its due date.
 */
export function reschedulePatch(task: Pick<Task, "startDate" | "dueDate">, to: string): Pick<Task, "startDate" | "dueDate"> {
  if (!task.dueDate) return { startDate: task.startDate, dueDate: to };
  const delta = daysBetween(task.dueDate, to);
  return { startDate: task.startDate ? addDays(task.startDate, delta) : null, dueDate: to };
}

// Timeline -------------------------------------------------------------------------

export type TimelineZoom = "weeks" | "months";

export interface TimelineRange {
  /** A Monday. */
  start: string;
  days: number;
  /** Pixels per day. */
  dayWidth: number;
}

/**
 * The window the Timeline draws: three weeks before today and ten after at the
 * week zoom, eight weeks before and twenty-six after at the month zoom.
 */
export function timelineRange(today: string, zoom: TimelineZoom): TimelineRange {
  return zoom === "weeks"
    ? { start: weekStart(addDays(today, -21)), days: 7 * 13, dayWidth: 32 }
    : { start: weekStart(addDays(today, -56)), days: 7 * 34, dayWidth: 11 };
}

/** Pixels from the range's left edge to the start of `value`. */
export function dayX(range: TimelineRange, value: string): number {
  return daysBetween(range.start, value) * range.dayWidth;
}

/**
 * Where a Task's bar sits: from its start date (or its due date when it has
 * no start, or a start after its due) through the end of its due date, never
 * narrower than one day. Undated Tasks have no bar.
 */
export function barSpan(task: Pick<Task, "startDate" | "dueDate">): { from: string; to: string } | null {
  if (!task.dueDate) return null;
  const from = task.startDate && task.startDate <= task.dueDate ? task.startDate : task.dueDate;
  return { from, to: task.dueDate };
}

export function barGeometry(range: TimelineRange, task: Pick<Task, "startDate" | "dueDate">): { x: number; width: number } | null {
  const span = barSpan(task);
  if (!span) return null;
  return {
    x: dayX(range, span.from),
    width: Math.max(range.dayWidth, (daysBetween(span.from, span.to) + 1) * range.dayWidth),
  };
}

/** The months the header spans, each with its width in days. */
export function timelineMonths(range: TimelineRange): { month: string; label: string; days: number }[] {
  const out: { month: string; label: string; days: number }[] = [];
  for (let i = 0; i < range.days; i++) {
    const month = monthOf(addDays(range.start, i));
    const last = out[out.length - 1];
    if (last?.month === month) last.days++;
    else out.push({ month, label: shortMonthLabel(month), days: 1 });
  }
  return out;
}

/** A pointer travel in pixels as whole days, the way a dragged bar snaps. */
export function snapDays(pixels: number, dayWidth: number): number {
  return Math.round(pixels / dayWidth) || 0;
}

export type BarEdit = "move" | "start" | "end";

/**
 * A dragged bar's new dates. Moving shifts both; pulling an end changes that
 * end only, and never past the other one.
 */
export function barEditPatch(
  task: Pick<Task, "startDate" | "dueDate">,
  edit: BarEdit,
  days: number
): Pick<Task, "startDate" | "dueDate"> | null {
  const span = barSpan(task);
  if (!span || days === 0) return null;
  if (edit === "move") {
    return { startDate: task.startDate ? addDays(span.from, days) : null, dueDate: addDays(span.to, days) };
  }
  if (edit === "start") {
    const from = addDays(span.from, days);
    return { startDate: from > span.to ? span.to : from, dueDate: span.to };
  }
  // Stretching a one-day bar gives it a start: the day it used to cover.
  const to = addDays(span.to, days);
  const due = to < span.from ? span.from : to;
  return { startDate: task.startDate ?? (due > span.from ? span.from : null), dueDate: due };
}

/**
 * A dependency arrow from the end of the blocker's bar to the start of the
 * blocked one: out to the right, then a curve into the target's row.
 */
export function dependencyPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const reach = Math.max(12, Math.abs(to.x - from.x) / 2);
  return `M${from.x} ${from.y} C${from.x + reach} ${from.y} ${to.x - reach} ${to.y} ${to.x} ${to.y}`;
}

/** Tasks with no due date have no place on a timeline: counted, not drawn. */
export function unscheduledCount(tasks: readonly Pick<Task, "dueDate">[]): number {
  return tasks.filter((task) => !task.dueDate).length;
}

// The address ------------------------------------------------------------------------

export type CalendarPeriod = "month" | "week";

/**
 * Where the Calendar and the Timeline are looking, kept in the URL beside the
 * view's query (#1050): `?period=week&date=2026-10-05`, `?zoom=months`. An
 * empty date means today, so the default view keeps a bare address and a
 * shared link opens on the period its sender was looking at.
 */
export interface DateViewUrlState {
  period: CalendarPeriod;
  date: string;
  zoom: TimelineZoom;
}

export const DATE_VIEW_DEFAULTS: DateViewUrlState = { period: "month", date: "", zoom: "weeks" };

/** The URL's date view; a value it cannot be (a 31 February, a typo) falls back to its default. */
export function dateViewFromSearchParams(params: SearchParamsLike): DateViewUrlState {
  const state = filtersFromSearchParams(params, DATE_VIEW_DEFAULTS, {
    period: ["month", "week"],
    zoom: ["weeks", "months"],
  });
  return { ...state, date: isDay(state.date) ? state.date : "" };
}

function isDay(value: string): boolean {
  try {
    return iso(day(value)) === value;
  } catch {
    return false;
  }
}
