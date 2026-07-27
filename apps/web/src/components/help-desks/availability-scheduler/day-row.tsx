"use client";

import { AnimatePresence, motion } from "motion/react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { type DayAvailability, type TimeRange, type WeekDay } from "@agent-hub/core";
import {
  type TimeOption,
  WEEKDAYS,
  closesMinutes,
  fromMinutes,
  opensMinutes,
  rangeId,
} from "./types";

/** One time-of-day dropdown (opens or closes edge of a range). */
function TimeSelect({
  value,
  options,
  label,
  onChange,
}: {
  value: number;
  options: TimeOption[];
  label: string;
  onChange: (minutes: number) => void;
}) {
  const current = options.find((o) => o.minutes === value);
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger aria-label={label} size="sm" className="w-[6.25rem] px-2.5">
        <SelectValue>{() => current?.label ?? "--:--"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.minutes} value={String(o.minutes)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DayRow({
  day,
  label,
  state,
  options,
  step,
  reduce,
  onChange,
  onCopy,
}: {
  day: WeekDay;
  label: string;
  state: DayAvailability;
  options: TimeOption[];
  step: number;
  reduce: boolean;
  onChange: (next: DayAvailability) => void;
  onCopy: (targets: WeekDay[]) => void;
}) {
  const enabled = state.enabled;

  function setEnabled(on: boolean) {
    // Turning a day on with no windows yet seeds a sensible 09:00–17:00.
    if (on && state.ranges.length === 0) {
      onChange({ enabled: true, ranges: [defaultRange()] });
      return;
    }
    onChange({ ...state, enabled: on });
  }

  function defaultRange(): TimeRange {
    return { id: rangeId(), opensHour: 9, opensMinute: 0, closesHour: 17, closesMinute: 0 };
  }

  function updateRange(id: string, patch: Partial<TimeRange>) {
    onChange({
      ...state,
      ranges: state.ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  function setOpens(id: string, minutes: number) {
    const { hour, minute } = fromMinutes(minutes);
    updateRange(id, { opensHour: hour, opensMinute: minute });
  }

  function setCloses(id: string, minutes: number) {
    const { hour, minute } = fromMinutes(minutes);
    updateRange(id, { closesHour: hour, closesMinute: minute });
  }

  function addRange() {
    // Start the new window one step after the last one closes, clamped to the day.
    const last = state.ranges[state.ranges.length - 1];
    const start = last ? Math.min(closesMinutes(last) + step, 23 * 60) : 9 * 60;
    const end = Math.min(start + 60, 24 * 60 - step);
    const s = fromMinutes(start);
    const e = fromMinutes(end);
    onChange({
      enabled: true,
      ranges: [
        ...state.ranges,
        {
          id: rangeId(),
          opensHour: s.hour,
          opensMinute: s.minute,
          closesHour: e.hour,
          closesMinute: e.minute,
        },
      ],
    });
  }

  function removeRange(id: string) {
    const ranges = state.ranges.filter((r) => r.id !== id);
    onChange({ enabled: ranges.length > 0 && enabled, ranges });
  }

  const dur = reduce ? 0 : 0.16;
  const others = WEEKDAYS.filter((d) => d.key !== day);

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-4">
      <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2.5 pt-1.5 font-medium">
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
        />
        {label}
      </label>

      <div className="min-w-0 flex-1">
        {!enabled || state.ranges.length === 0 ? (
          <p className="text-muted-foreground pt-2 text-sm">Unavailable</p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {state.ranges.map((r) => (
                <motion.div
                  key={r.id}
                  layout={!reduce}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: dur }}
                  className="flex items-center gap-2 overflow-hidden"
                >
                  <TimeSelect
                    value={opensMinutes(r)}
                    options={options}
                    label={`${label} window opens`}
                    onChange={(m) => setOpens(r.id, m)}
                  />
                  <span className="text-muted-foreground">–</span>
                  <TimeSelect
                    value={closesMinutes(r)}
                    options={options}
                    label={`${label} window closes`}
                    onChange={(m) => setCloses(r.id, m)}
                  />
                  <Hint label="Remove window">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove window"
                      className="text-muted-foreground hover:text-destructive size-9 shrink-0"
                      onClick={() => removeRange(r.id)}
                    >
                      <AnimatedIcon icon={Trash2} size={15} />
                    </Button>
                  </Hint>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Hint label="Add a window">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Add a window"
            className="text-muted-foreground size-9"
            onClick={addRange}
          >
            <AnimatedIcon icon={Plus} size={16} />
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copy times to other days"
                className="text-muted-foreground size-9"
                disabled={!enabled || state.ranges.length === 0}
              >
                <AnimatedIcon icon={Copy} size={15} />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Copy times to…</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onCopy(others.map((d) => d.key))}>
              All other days
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {others.map((d) => (
              <DropdownMenuItem key={d.key} onClick={() => onCopy([d.key])}>
                {d.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
