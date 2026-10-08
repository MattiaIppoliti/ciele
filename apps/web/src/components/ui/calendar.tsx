"use client";

import { DatePicker, DateRangePicker } from "./date-picker";

/** ISO adapters retain the existing API while sharing the BoardUI date picker. */
export function Calendar({ value, onSelect, className }: {
  value: string | null; onSelect: (iso: string) => void; className?: string;
}) {
  return <DatePicker label="Date" value={value} onChange={onSelect} className={className} />;
}
export function CalendarRange({ from, to, onSelect, className }: {
  from: string | null; to: string | null;
  onSelect: (from: string, to: string, complete: boolean) => void; className?: string;
}) {
  return <DateRangePicker label="Date range" from={from} to={to} className={className}
    onChange={(from, to) => onSelect(from, to, true)} />;
}
