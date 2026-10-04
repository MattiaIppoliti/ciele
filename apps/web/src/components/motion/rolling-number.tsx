import { formatCount, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MorphText } from "./morph-text";

const FORMATS = { count: formatCount, percent: formatPercent } as const;

/**
 * Quicker than a title's roll: a character counter changes on every keystroke,
 * and a 900ms roll per key would trail behind the typing.
 */
const NUMBER_ROLL_MS = 380;

/** Shared formatted counters use Torph's place-value morphing on changes. */
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
    <MorphText
      text={FORMATS[format](value)}
      className={cn("tabular-nums", className)}
      duration={NUMBER_ROLL_MS}
    />
  );
}
