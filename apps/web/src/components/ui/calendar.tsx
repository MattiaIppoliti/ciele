"use client";

import type { DateRange } from "react-day-picker";

import { Calendar as UiCalendar } from "@agent-hub/ui";
import { isoDay } from "@agent-hub/core";
import { cn } from "@/lib/utils";

/**
 * String-based adapters over the shared shadcn `Calendar` (react-day-picker).
 *
 * The rest of the app stores dates as `yyyy-mm-dd` strings, so these wrappers
 * keep that ergonomic API while the actual rendering is the standard shadcn
 * base-nova calendar from `@agent-hub/ui`. New code that works in `Date`
 * objects should import `Calendar` from `@agent-hub/ui` directly.
 */

/** Parse a yyyy-mm-dd string to a local Date (no timezone shift). */
function parseIsoDay(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function Calendar({
  value,
  onSelect,
  className,
}: {
  /** Selected date as yyyy-mm-dd, or null. */
  value: string | null;
  onSelect: (iso: string) => void;
  className?: string;
}) {
  const selected = parseIsoDay(value);
  return (
    <UiCalendar
      mode="single"
      selected={selected}
      defaultMonth={selected}
      onSelect={(date) => onSelect(date ? isoDay(date) : "")}
      className={cn("rounded-lg border", className)}
    />
  );
}

export function CalendarRange({
  from,
  to,
  onSelect,
  className,
}: {
  /** Committed range bounds as yyyy-mm-dd, or null. */
  from: string | null;
  to: string | null;
  /** `complete` is false on the first click of a new range (still picking
   * the end date) and true once both ends are set, callers typically use
   * it to close the picker only when the range is finished. */
  onSelect: (from: string, to: string, complete: boolean) => void;
  className?: string;
}) {
  const start = parseIsoDay(from);
  const selected: DateRange | undefined = start
    ? { from: start, to: parseIsoDay(to) }
    : undefined;
  return (
    <UiCalendar
      mode="range"
      numberOfMonths={2}
      selected={selected}
      defaultMonth={start}
      onSelect={(range: DateRange | undefined) => {
        const a = range?.from ? isoDay(range.from) : "";
        const b = range?.to
          ? isoDay(range.to)
          : range?.from
            ? isoDay(range.from)
            : "";
        const complete = Boolean(range?.from && range?.to);
        onSelect(a, b, complete);
      }}
      className={cn("rounded-lg border", className)}
    />
  );
}
