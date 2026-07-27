import type { DayAvailability, TimeRange, WeekDay } from "@agent-hub/core";

export type { DayAvailability, TimeRange, WeekDay };

/** The seven-day opening schedule edited by the scheduler. */
export type WeekHours = Record<WeekDay, DayAvailability>;

export const WEEKDAYS: { key: WeekDay; label: string; short: string }[] = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

export interface TimeOption {
  minutes: number;
  label: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Selectable times of day, one every `step` minutes (00:00 … 23:xx). */
export function buildOptions(step: number): TimeOption[] {
  const out: TimeOption[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    out.push({ minutes: m, label: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` });
  }
  return out;
}

export function opensMinutes(r: TimeRange): number {
  return r.opensHour * 60 + r.opensMinute;
}

export function closesMinutes(r: TimeRange): number {
  return r.closesHour * 60 + r.closesMinute;
}

/** Split minutes-of-day back into the `{Hour, Minute}` pair the model stores. */
export function fromMinutes(minutes: number): { hour: number; minute: number } {
  return { hour: Math.floor(minutes / 60) % 24, minute: minutes % 60 };
}

let counter = 0;

/** Stable-enough client id for a range row (never persisted as meaningful). */
export function rangeId(): string {
  counter += 1;
  return `r${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
