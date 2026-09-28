"use client";

import { useState, useSyncExternalStore } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { CalendarRange } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { RollInText } from "@/components/motion/roll-in-text";
import { formatDay } from "@/lib/format";
import { lastDaysRange, trailingRangeDays, utcDay } from "@/lib/insights/range";

const PRESETS = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 14 Days", days: 14 },
  { label: "Last 30 Days", days: 30 },
  { label: "Last 3 Months", days: 90 },
  { label: "Last 12 Months", days: 365 },
] as const;

const noSubscription = () => () => {};
const todayOnClient = () => utcDay(new Date());
// The server cannot know the reader's "today" at hydration, so it names no
// preset and the label rolls to one once the browser has taken over.
const todayOnServer = () => null;

function presetLabel(from: string, to: string, today: string | null): string | null {
  if (!today) return null;
  const days = trailingRangeDays(from, to, today);
  return PRESETS.find((p) => p.days === days)?.label ?? null;
}

/** "03 Jul 2026 – 30 Jul 2026", the custom range as the trigger and the chip spell it. */
export function formatRange(from: string, to: string): string {
  return `${from ? formatDay(from) : "…"} – ${to ? formatDay(to) : "…"}`;
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
  const today = useSyncExternalStore(noSubscription, todayOnClient, todayOnServer);

  function applyPreset(days: number) {
    const range = lastDaysRange(days);
    onChange(range.from, range.to);
    setOpen(false);
  }

  const preset = presetLabel(from, to, today);
  const label = preset ?? (from && to ? formatRange(from, to) : "Date range");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="h-10 max-w-full rounded-lg px-4" />
        }
      >
        <CalendarIcon className="size-4 shrink-0" aria-hidden />
        {/* Scritto cannot ellipsize, so the label stays one short line: a
            preset name or two formatted days. */}
        <RollInText text={label} className="whitespace-nowrap" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="w-40 border-r p-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={preset === p.label}
                onClick={() => applyPreset(p.days)}
                className={`press-control hover:bg-muted focus-visible:outline-ring flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-2 ${
                  preset === p.label ? "bg-muted font-medium" : ""
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
