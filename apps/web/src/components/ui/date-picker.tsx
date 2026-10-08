"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { cn } from "@/lib/utils";
import { formatPickerDate, type PickerPreset } from "@/lib/date-picker";

// React Aria and date math load only when a picker opens, not with every table.
const PickerPanel = dynamic(() => import("./date-picker-panel"), {
  ssr: false,
  loading: () => <div role="status" className="p-6 text-sm text-muted-foreground">Loading calendar…</div>,
});

interface PickerChrome {
  label: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  allowClear?: boolean;
}
export type DatePickerProps = PickerChrome & { value: string | null; onChange: (value: string) => void };
export type DateRangePickerProps = PickerChrome & {
  from: string | null;
  to: string | null;
  onChange: (from: string, to: string) => void;
  presets?: () => PickerPreset[];
};

export function DatePicker({ value, onChange, ...chrome }: DatePickerProps) {
  return <Picker {...chrome} mode="single" from={value ?? ""} to="" onChange={(from) => onChange(from)} />;
}
export function DateRangePicker({ from, to, ...props }: DateRangePickerProps) {
  return <Picker {...props} mode="range" from={from ?? ""} to={to ?? ""} />;
}

function Picker({ mode, from, to, onChange, label, disabled, className, compact, allowClear, presets }: PickerChrome & {
  mode: "single" | "range";
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  presets?: () => PickerPreset[];
}) {
  const [open, setOpen] = useState(false);
  const text = mode === "single" ? formatPickerDate(from) : from || to
    ? `${from ? formatPickerDate(from) : "…"} – ${to ? formatPickerDate(to) : "…"}` : "Select date range";
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<button type="button" disabled={disabled} aria-label={`${label}: ${text}`}
      className={cn("date-picker-trigger", className)} />}>
      <CalendarIcon className="size-4 shrink-0" aria-hidden />
      <span className={cn("truncate", compact && "hidden lg:inline")}>{text}</span>
    </PopoverTrigger>
    <PopoverContent aria-label={label} className="date-picker-popover w-auto p-0" align="start">
      {open && <PickerPanel mode={mode} from={from} to={to} label={label} allowClear={allowClear}
        presets={presets?.()} onCancel={() => setOpen(false)}
        onApply={(a, b) => { onChange(a, b); setOpen(false); }} />}
    </PopoverContent>
  </Popover>;
}
