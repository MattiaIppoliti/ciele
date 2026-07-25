"use client";

import { LayoutGroup, useReducedMotion } from "motion/react";
import { useCallback, useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { DayRow } from "./day-row";
import {
  type DayAvailability,
  type WeekDay,
  type WeekHours,
  WEEKDAYS,
  buildOptions,
  rangeId,
} from "./types";

export type { DayAvailability, TimeRange, WeekDay, WeekHours } from "./types";

export interface AvailabilitySchedulerProps {
  /** The seven-day opening schedule (a channel's `availability.hours`). */
  value: WeekHours;
  onChange: (value: WeekHours) => void;
  /** Minutes between selectable times. Default 30. */
  step?: number;
  className?: string;
}

/**
 * Weekly opening-hours picker: per day, toggle availability and stack one or
 * more time windows, then copy a day's windows onto others. Replaces the older
 * single-window-per-day table; the model now stores `ranges[]` per day.
 */
export function AvailabilityScheduler({
  value,
  onChange,
  step = 30,
  className,
}: AvailabilitySchedulerProps) {
  const reduce = useReducedMotion() ?? false;
  const groupId = useId();
  const options = useMemo(() => buildOptions(step), [step]);

  const setDay = useCallback(
    (day: WeekDay, next: DayAvailability) => {
      onChange({ ...value, [day]: next });
    },
    [onChange, value],
  );

  const copyDay = useCallback(
    (from: WeekDay, targets: WeekDay[]) => {
      const source = value[from];
      const next = { ...value };
      for (const t of targets) {
        next[t] = {
          enabled: source.enabled,
          // Fresh ids so each day owns its window rows independently.
          ranges: source.ranges.map((r) => ({ ...r, id: rangeId() })),
        };
      }
      onChange(next);
    },
    [onChange, value],
  );

  return (
    <LayoutGroup id={groupId}>
      <div className={cn("w-full divide-y divide-border", className)}>
        {WEEKDAYS.map(({ key, label }) => (
          <DayRow
            key={key}
            day={key}
            label={label}
            state={value[key]}
            options={options}
            step={step}
            reduce={reduce}
            onChange={(next) => setDay(key, next)}
            onCopy={(targets) => copyDay(key, targets)}
          />
        ))}
      </div>
    </LayoutGroup>
  );
}
