import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "./cn";
import type { TrendDirection } from "./types";

/**
 * Compact KPI stat tile in the reference dashboard style: uppercase mono
 * label, large tabular numeral, mini bar sparkline on the right, and an
 * optional delta footer ("+12% vs previous period").
 *
 * Server-component safe — no client hooks, sparkline is plain CSS bars.
 */
export interface KpiStatCardProps {
  label: string;
  value: string | number;
  /** Small unit/suffix rendered after the value (e.g. "orders"). */
  unit?: string;
  /** Raw values for the mini sparkline; omitted → no sparkline. */
  sparkline?: readonly number[];
  /** Delta footer text (e.g. "+12% vs previous 30 days"). */
  delta?: ReactNode;
  deltaDirection?: TrendDirection;
  /** Secondary hint line when no delta applies. */
  hint?: string;
  className?: string;
}

function Sparkline({ values }: { values: readonly number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div aria-hidden className="flex h-9 items-end gap-[3px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            "w-[3px] rounded-full",
            v === max ? "bg-foreground" : "bg-foreground/15",
          )}
          style={{ height: `${Math.max((v / max) * 100, 8)}%` }}
        />
      ))}
    </div>
  );
}

/** Downsample a series to at most `buckets` points by summing each bucket. */
function downsample(values: readonly number[], buckets: number): number[] {
  if (values.length <= buckets) return [...values];
  const out = new Array<number>(buckets).fill(0);
  for (let i = 0; i < values.length; i++) {
    out[Math.min(buckets - 1, Math.floor((i / values.length) * buckets))] +=
      values[i];
  }
  return out;
}

export function KpiStatCard({
  label,
  value,
  unit,
  sparkline,
  delta,
  deltaDirection = "up",
  hint,
  className,
}: KpiStatCardProps) {
  const DeltaIcon =
    deltaDirection === "down"
      ? ArrowDownRight
      : deltaDirection === "flat"
        ? Minus
        : ArrowUpRight;
  const deltaColor =
    deltaDirection === "down"
      ? "text-rose-600"
      : deltaDirection === "flat"
        ? "text-muted-foreground"
        : "text-emerald-600";

  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_4px_16px_rgba(18,18,18,0.04)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-2 truncate font-mono text-2xl font-bold tracking-tight tabular-nums">
            {value}
            {unit && (
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                {unit}
              </span>
            )}
          </p>
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline values={downsample(sparkline, 8)} />
        )}
      </div>

      {(delta != null || hint) && (
        <div className="flex items-center gap-1.5 border-t border-border/60 pt-2.5 text-xs">
          {delta != null ? (
            <>
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full bg-muted",
                  deltaColor,
                )}
              >
                <DeltaIcon className="size-3" />
              </span>
              <span className={cn("font-medium", deltaColor)}>{delta}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{hint}</span>
          )}
        </div>
      )}
    </div>
  );
}
