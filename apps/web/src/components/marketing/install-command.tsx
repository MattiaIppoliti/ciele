"use client";

import { Button, CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";
import { cn } from "@/lib/utils";

/**
 * A single command on one line, with a copy button, the shape a terminal
 * one-liner wants above the fold.
 *
 * Deliberately not `CodeBlock`: that component gives every snippet a header
 * strip (language label or tab list) above the code, which is right for the
 * four-line install snippets further down the page and wrong for one command
 * that should read as a single object. Same primitives, same copy affordance,
 * one row instead of two.
 *
 * Web-only, so it lives here rather than in `packages/ui`.
 */
export function InstallCommand({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const copied = isCopied(command);

  return (
    <div
      className={cn(
        "border-border/70 bg-card/60 flex items-center gap-3 rounded-xl border py-1.5 pr-1.5 pl-4 backdrop-blur-sm",
        className
      )}
    >
      {/* The prompt is decoration; it must not travel into the clipboard, and
          a screen reader announcing "dollar" before the command is noise. */}
      <span aria-hidden="true" className="text-muted-foreground/70 font-mono text-sm">
        $
      </span>
      {/* Scrolls rather than wraps: a wrapped command changes the height of the
          pill, and on a narrow phone this line is genuinely wider than the
          viewport. `no-scrollbar` keeps that silent. */}
      {/* `text-left` because the hero this sits in is centered, and a command
          drifting away from its prompt reads as two separate things. */}
      <code className="text-foreground no-scrollbar min-w-0 flex-1 overflow-x-auto py-1.5 text-left font-mono text-[13px] whitespace-nowrap sm:text-sm">
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Command copied" : "Copy command"}
        onClick={() => void copyText(command, command)}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <CopyFeedbackIcon copied={copied} className="size-4" />
      </Button>
    </div>
  );
}
