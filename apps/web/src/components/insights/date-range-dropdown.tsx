"use client";

import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { CalendarRange } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { isoDay } from "@agent-hub/db";

const PRESETS = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 14 Days", days: 14 },
  { label: "Last 30 Days", days: 30 },
  { label: "Last 3 Months", days: 90 },
  { label: "Last 12 Months", days: 365 },
] as const;

function presetLabel(from: string, to: string): string | null {
  const toDate = new Date(`${to}T00:00:00`);
  const fromDate = new Date(`${from}T00:00:00`);
  if (isoDay(toDate) !== isoDay(new Date())) return null;
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  return PRESETS.find((p) => p.days === days)?.label ?? null;
}

/**
 * "Last 30 Days ⌄" control: quick presets plus a shadcn-style two-month
 * range calendar for a custom range.
 */
export function DateRangeDropdown({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function applyPreset(days: number) {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - (days - 1) * 86_400_000);
    onChange(isoDay(fromDate), isoDay(toDate));
    setOpen(false);
  }

  const label = presetLabel(from, to) ?? (from && to ? `${from} – ${to}` : "Date range");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="h-10 rounded-lg px-4" />}>
        <CalendarIcon className="size-4" /> {label}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="w-40 border-r p-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.days)}
                className={`hover:bg-muted flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm ${
                  presetLabel(from, to) === p.label ? "bg-muted font-medium" : ""
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="p-3">
            <CalendarRange
              from={from || null}
              to={to || null}
              onSelect={(a, b, complete) => {
                onChange(a, b);
                if (complete) setOpen(false);
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
