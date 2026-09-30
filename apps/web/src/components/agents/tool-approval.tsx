"use client";
// Trimmed from beui.dev/components/agents/tool-approval: only the states and
// handlers the chat's ApprovalCard uses. The original's parameter list, its
// "View details" disclosure, "Always allow" and the running/complete/error
// states were dropped with no caller left for them.

import { Check, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Button } from "@agent-hub/ui";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ToolApprovalStatus = "pending" | "approving" | "approved" | "denied";

export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  status?: ToolApprovalStatus;
  onApprove?: () => void;
  onDeny?: () => void;
  className?: string;
}

const STATUS_COPY: Record<ToolApprovalStatus, string> = {
  pending: "Approval required",
  approving: "Approving",
  approved: "Approved",
  denied: "Denied",
};

const STATUS_BADGE: Record<ToolApprovalStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approving: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  approved:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  denied: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

export function ToolApproval({
  tool,
  title = "Allow this tool to run?",
  description,
  status = "pending",
  onApprove,
  onDeny,
  className,
}: ToolApprovalProps) {
  const reduce = useReducedMotion() ?? false;
  const busy = status === "approving";

  return (
    <div
      data-state={status}
      aria-busy={busy}
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/60 bg-muted/20 text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-border/60 bg-background text-muted-foreground"
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : status === "denied" ? (
            <X className="size-4" />
          ) : status === "approved" ? (
            <Check className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{title}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {tool}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors",
                STATUS_BADGE[status],
              )}
            >
              {STATUS_COPY[status]}
            </span>
          </div>
          {description ? (
            <p className="mt-2 leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {/* No decision handlers means a read-only transcript (the Inbox):
            buttons there would do nothing, so the bar is left out. */}
        {status === "pending" && (onApprove || onDeny) ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3"
          >
            <Button type="button" size="sm" onClick={onApprove}>
              Allow once
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDeny}>
              Deny
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
