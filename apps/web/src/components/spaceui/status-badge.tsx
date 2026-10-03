import type { ComponentProps, ReactNode } from "react";
import type { BadgeTone } from "@agent-hub/ui";
import { cn } from "@/lib/utils";
import { RollInText } from "@/components/motion/roll-in-text";

export type StatusBadgeStatus =
  | "online"
  | "busy"
  | "away"
  | "warning"
  | "error"
  | "info"
  | "offline";

const DOT: Record<StatusBadgeStatus, string> = {
  online: "bg-emerald-500",
  busy: "bg-red-500",
  away: "bg-amber-400",
  warning: "bg-orange-500",
  error: "bg-red-600",
  info: "bg-sky-500",
  offline: "bg-gray-400",
};

const TONE_STATUS: Record<BadgeTone, StatusBadgeStatus> = {
  none: "offline",
  gray: "offline",
  blue: "info",
  green: "online",
  amber: "away",
  red: "error",
  purple: "info",
};

/** Preserve existing domain colour mappings while using one status renderer. */
export function statusFromTone(tone: BadgeTone): StatusBadgeStatus {
  return TONE_STATUS[tone];
}

/** A status dot and its label. Details belong in a tooltip or beside the badge. */
export function StatusBadge({
  status,
  primaryText,
  animated = false,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  status: StatusBadgeStatus;
  primaryText: ReactNode;
  animated?: boolean;
}) {
  return (
    <span
      {...props}
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "bg-alpha-light text-foreground inline-flex min-h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          DOT[status],
          animated && "motion-safe:animate-pulse",
        )}
      />
      {typeof primaryText === "string" || typeof primaryText === "number" ? (
        <RollInText text={String(primaryText)} />
      ) : primaryText}
    </span>
  );
}
