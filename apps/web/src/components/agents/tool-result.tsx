"use client";
// beui.dev/components/agents/tool-result

import { Ban, ChevronDown, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
// Icon data for the copy mark, which reshapes into the check on click.
import { Check as CheckData, Copy as CopyData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AgentCode,
  type AgentCodeLanguage,
} from "@/components/agents/agent-code";
import { ActionSwapText } from "@/components/motion/action-swap";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { SPRING_SWAP } from "@/lib/ease";
import { Button } from "@agent-hub/ui";
import { useCopied } from "@/lib/hooks/use-copied";
import { cn } from "@/lib/utils";

export type ToolResultStatus = "running" | "success" | "error" | "cancelled";

// Trimmed from upstream to what the Thinking panel passes: uncontrolled,
// collapsing when the call finishes, with a copy action and no retry.
export interface ToolResultProps {
  tool: ReactNode;
  title: ReactNode;
  children: ReactNode;
  status?: ToolResultStatus;
  meta?: ReactNode;
  icon: ReactNode;
  defaultOpen?: boolean;
  copyText?: string;
  className?: string;
}

export interface ToolResultOutputProps {
  children: string;
  language?: AgentCodeLanguage;
  className?: string;
}

function getStatusLabel(status: ToolResultStatus) {
  if (status === "running") return "Running";
  if (status === "success") return "Completed";
  if (status === "error") return "Failed";
  return "Cancelled";
}

function getSwapKey(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function getStatusClass(status: ToolResultStatus) {
  if (status === "running") {
    return "text-blue-600 dark:text-blue-400";
  }
  if (status === "success") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (status === "error") {
    return "text-rose-600 dark:text-rose-400";
  }
  return "text-muted-foreground";
}

function StatusIcon({
  status,
  reduce,
}: {
  status: ToolResultStatus;
  reduce: boolean;
}) {
  if (status === "running") {
    return <LoaderCircle className={cn("size-3", !reduce && "animate-spin")} />;
  }
  if (status === "success") return <CircleCheck className="size-3" />;
  if (status === "error") return <CircleX className="size-3" />;
  return <Ban className="size-3" />;
}

function ToolResultAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
    >
      {children}
    </Button>
  );
}

export function ToolResultOutput({
  children,
  language = "bash",
  className,
}: ToolResultOutputProps) {
  return (
    <AgentCode
      code={children}
      language={language}
      className={cn(
        "whitespace-pre-wrap break-words text-foreground/80",
        className,
      )}
    />
  );
}

export function ToolResult({
  tool,
  title,
  children,
  status = "running",
  meta,
  icon,
  defaultOpen = true,
  copyText,
  className,
}: ToolResultProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const [copied, markCopied] = useCopied();
  const [currentOpen, setOpen] = useState(defaultOpen);
  const running = status === "running";
  const titleKey = getSwapKey(title, status);
  const metaKey = getSwapKey(meta, `${status}-meta`);
  const toolKey = getSwapKey(tool, `${status}-tool`);
  const statusLabel = getStatusLabel(status);

  useEffect(() => {
    if (previousStatus.current !== "running" && status === "running") {
      setOpen(true);
    }
    if (previousStatus.current === "running" && status !== "running") {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [status]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !currentOpen || !running) return;

    const frame = requestAnimationFrame(() => {
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  const handleCopy = async () => {
    if (copyText) await navigator.clipboard?.writeText(copyText);
    markCopied();
  };

  return (
    <div
      data-state={status}
      aria-busy={running}
      className={cn("w-full text-sm", className)}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex min-h-9 w-full items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center text-muted-foreground"
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate font-medium text-foreground/90">
            <ActionSwapText value={titleKey}>
              {title}
            </ActionSwapText>
          </span>
          {meta ? (
            <span className="shrink-0 text-xs text-muted-foreground/60">
              <ActionSwapText value={metaKey}>
                {meta}
              </ActionSwapText>
            </span>
          ) : null}
          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground/55">
            <ActionSwapText value={toolKey}>
              {tool}
            </ActionSwapText>
          </span>
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-2xs font-medium",
            getStatusClass(status),
          )}
        >
          <StatusIcon status={status} reduce={reduce} />
          <ActionSwapText value={status}>
            {statusLabel}
          </ActionSwapText>
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={currentOpen}
      >
        <div className="pl-6 pt-1.5">
          <div className="overflow-hidden rounded-xl bg-muted/80">
          <div
            ref={viewportRef}
            role="log"
            aria-live="polite"
            className="scrollbar-hide overflow-y-auto"
            style={{ maxHeight: 220 }}
          >
            <div className="p-3">{children}</div>
          </div>

            {copyText ? (
              <div className="flex items-center gap-0.5 px-2 pb-1.5">
              <ToolResultAction
                label={copied ? "Copied" : "Copy result"}
                onClick={handleCopy}
              >
                <MorphIcon icon={copied ? CheckData : CopyData} size={14} />
              </ToolResultAction>
              <span className="ml-auto text-2xs text-muted-foreground/55">
                <ActionSwapText value={status}>
                  {statusLabel}
                </ActionSwapText>
              </span>
              </div>
            ) : null}
          </div>
        </div>
      </AgentDisclosure>
    </div>
  );
}
