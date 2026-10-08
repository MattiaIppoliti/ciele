"use client";

import { DateRangePicker } from "@/components/ui/date-picker";
import { formatDay } from "@/lib/format";
import { lastDaysRange } from "@/lib/insights/range";

const PRESETS = [
  { label: "Last 7 Days", days: 7 }, { label: "Last 14 Days", days: 14 },
  { label: "Last 30 Days", days: 30 }, { label: "Last 3 Months", days: 90 },
  { label: "Last 12 Months", days: 365 },
];

export function formatRange(from: string, to: string): string {
  return `${from ? formatDay(from) : "…"} – ${to ? formatDay(to) : "…"}`;
}

export function DateRangeDropdown({ from, to, onChange }: {
  from: string; to: string; onChange: (from: string, to: string) => void;
}) {
  return <DateRangePicker label="Date range" from={from} to={to} onChange={onChange}
    presets={() => PRESETS.map(preset => ({ label: preset.label, range: lastDaysRange(preset.days) }))} />;
}
