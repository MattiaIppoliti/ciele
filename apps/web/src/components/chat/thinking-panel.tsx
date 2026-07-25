"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import type { TurnPhase, TurnStep } from "@/lib/runtime/client";
import { StepIcon, stepIconName } from "./tool-icons";
import { ToolCallsSection } from "./tool-calls-section";

/**
 * The agentic status panel both chat UIs (Widget + admin Preview) render above
 * a reply: a phase label with a spinner while the agent works ("Thinking…" →
 * "Deciding what to do…" → "Preparing to search…" → "Looking into it…" →
 * "Gathering info…" → "Cross-checking…"), a stacked-icon pill showing the
 * distinct step/tool kinds seen so far (tool-icons.tsx — never one icon
 * reused for everything) plus a search-count badge (×N once the agent has
 * searched more than once), and a collapsible ToolCallsSection timeline of
 * the reasoning/tool steps. When the answer lands it collapses to
 * "Thought for X.Xs".
 */

/** De-dupes steps by "kind" so the header pill shows each distinct icon once. */
function distinctStepKinds(steps: TurnStep[]): TurnStep[] {
  const seen = new Set<string>();
  const result: TurnStep[] = [];
  for (const step of steps) {
    const key =
      step.kind === "tool"
        ? `tool:${step.tool}`
        : step.kind === "thought"
          ? "thought"
          : `stage:${step.stage ?? "step"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }
  return result;
}

const PHASE_LABELS: Record<TurnPhase, string> = {
  starting: "Thinking…",
  deciding: "Deciding what to do…",
  preparing: "Preparing to search…",
  thinking: "Thinking…",
  searching: "Looking into it…",
  crosschecking: "Cross-checking…",
  reading: "Gathering info…",
  answering: "Thinking…", // unused while finished; safe fallback
  done: "Thinking…",
};

export function ThinkingPanel({
  steps,
  phase,
  searchCount,
  active,
}: {
  steps: TurnStep[];
  phase: TurnPhase;
  searchCount: number;
  active: boolean;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const startRef = useRef<number | null>(null);
  const [thoughtMs, setThoughtMs] = useState<number | null>(null);

  // Anchor the "Thought for X.Xs" timer at mount (i.e. when the turn starts).
  useEffect(() => {
    if (startRef.current === null) startRef.current = Date.now();
  }, []);

  const finished = !active || phase === "answering" || phase === "done";

  // Stamp "Thought for X.Xs" the first time the turn reaches its answer.
  useEffect(() => {
    if (finished && thoughtMs === null && steps.length > 0) {
      setThoughtMs(Date.now() - (startRef.current ?? Date.now()));
    }
  }, [finished, thoughtMs, steps.length]);

  // Nothing to show: turn is over and produced no thinking activity
  // (e.g. a verbatim custom-message flow, or a history-loaded message).
  if (steps.length === 0 && finished) return null;

  // Auto-expanded while the agent works (live italic narration, as in the
  // reference), collapsed once done unless the user opens it.
  const open = (userOpen || !finished) && steps.length > 0;
  const seconds = thoughtMs !== null ? (thoughtMs / 1000).toFixed(1) : null;
  const stack = distinctStepKinds(steps).slice(0, 4);

  return (
    <div className="max-w-[92%]">
      <button
        type="button"
        onClick={() => setUserOpen(!userOpen)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1 rounded-full border bg-background py-1 pr-2 pl-1">
          <span className="flex -space-x-1.5">
            {stack.length > 0 ? (
              stack.map((step) => (
                <StepIcon
                  key={step.id}
                  step={step}
                  className="size-5 shrink-0 ring-2 ring-background"
                />
              ))
            ) : (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </span>
          <span className="sr-only">
            {stack.map((step) => stepIconName(step)).join(", ")}
          </span>
          {searchCount > 1 && (
            <span className="text-[11px] font-semibold text-muted-foreground">
              ×{searchCount}
            </span>
          )}
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          {finished ? (
            `Thought for ${seconds ?? "a few"}s`
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="thinking-label-glow">
                {PHASE_LABELS[phase]}
              </span>
              <LoaderCircle className="size-3.5 animate-spin" />
            </span>
          )}
        </span>
        {steps.length > 0 &&
          (open ? (
            <ChevronUp className="ml-auto size-4 shrink-0 text-muted-foreground/70" />
          ) : (
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground/70" />
          ))}
      </button>
      {open && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border bg-muted/40 px-3 py-2.5">
          <ToolCallsSection steps={steps} />
        </div>
      )}
    </div>
  );
}
