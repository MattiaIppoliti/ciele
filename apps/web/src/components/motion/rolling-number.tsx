import { formatCount, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RollInText } from "./roll-in-text";

const FORMATS = { count: formatCount, percent: formatPercent } as const;

/**
 * Quicker than a title's roll: a character counter changes on every keystroke,
 * and a 900ms roll per key would trail behind the typing.
 */
const NUMBER_ROLL_MS = 380;

/**
 * A number that rolls digit by digit when it changes: a badge count, a KPI, a
 * lane total. Scritto reads the direction from the two values, so a count that
 * goes up rolls up and one that goes down rolls down, and it skips the motion
 * under `prefers-reduced-motion`.
 *
 * No "use client" on purpose: a server component can render this, and the
 * formatted string is all that crosses into `RollInText`. Tabular figures keep
 * a changing value from nudging whatever sits beside it.
 */
export function RollingNumber({
  value,
  format = "count",
  className,
}: {
  value: number;
  format?: keyof typeof FORMATS;
  className?: string;
}) {
  return (
    <RollInText
      text={FORMATS[format](value)}
      className={cn("tabular-nums", className)}
      duration={NUMBER_ROLL_MS}
    />
  );
}
