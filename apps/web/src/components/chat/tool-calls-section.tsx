"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TurnStep } from "@agent-hub/agent/client";
import { StepIcon, formatToolName } from "./tool-icons";

/**
 * The Thinking panel's body: a vertical timeline of one turn's steps —
 * classify/generate/search stages, reasoning thoughts, and tool calls —
 * each with its own icon (tool-icons.tsx) linked by a connector line. Tool
 * calls collapse to their one-line label and expand to the model's call
 * arguments and outcome summary (both already deemed safe to show client-side
 * by runtime/tools.ts — never raw secrets).
 */
export function ToolCallsSection({
  steps,
  className,
}: {
  steps: TurnStep[];
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className={className}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const hasInput = Boolean(
          step.input && Object.keys(step.input).length > 0
        );
        const expandable =
          hasInput || Boolean(step.detail) || step.durationMs !== undefined;
        const open = openId === step.id;

        return (
          <div key={step.id} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <StepIcon step={step} className="size-6" />
              {!isLast && <div className="my-0.5 w-px flex-1 bg-border" />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-3"}`}>
              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpenId(open ? null : step.id)}
                aria-expanded={expandable ? open : undefined}
                className={`flex w-full items-start gap-1.5 text-left ${
                  expandable ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <p
                  className={`text-[13px] leading-relaxed text-muted-foreground ${
                    step.kind === "thought" ? "italic whitespace-pre-wrap" : ""
                  } ${step.status === "running" ? "animate-pulse" : ""}`}
                >
                  {step.label}
                  {step.status === "error" && (
                    <span className="text-destructive"> (failed)</span>
                  )}
                </p>
                {expandable && (
                  <span className="mt-0.5 shrink-0 text-muted-foreground/70">
                    {open ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </span>
                )}
              </button>
              {open && expandable && (
                <div className="mt-1.5 space-y-1.5 rounded-lg border bg-background/60 px-2.5 py-2 text-[12px]">
                  {step.tool && (
                    <p className="font-medium text-foreground/80">
                      {formatToolName(step.tool)}
                    </p>
                  )}
                  {hasInput && (
                    <div>
                      <p className="text-muted-foreground/80">Input</p>
                      <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {step.detail &&
                    (step.kind === "tool" ? (
                      <div>
                        <p className="text-muted-foreground/80">Output</p>
                        <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                          {step.detail}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-muted-foreground italic">
                        {step.detail}
                      </p>
                    ))}
                  {step.durationMs !== undefined && (
                    <p className="text-muted-foreground/60">
                      {step.durationMs}ms
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
