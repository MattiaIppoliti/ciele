"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
// Icon *data* for the morphing chevron, not components: morphicons samples the
// paths and springs between them.
import { ChevronDown, ChevronUp } from "lucide";
import { MorphIcon } from "morphicons/react";
import type { TurnPhase, TurnStep } from "@agent-hub/agent/client";
import { StepIcon, stepIconName } from "./tool-icons";
import { ThinkingTimeline } from "./thinking-timeline";
import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";
import { ThinkingOrb } from "@/components/orbs/thinking-orb";
import { chatVisibleSteps, liveOrbState, liveTraceLabel } from "./stored-trace";

/**
 * The agentic status panel both chat UIs (Widget + admin Preview) render above
 * a reply: a live label with a spinner while the agent works, a stacked-icon
 * pill showing the distinct step/tool kinds seen so far (tool-icons.tsx — never
 * one icon reused for everything) plus a search-count badge (×N once the agent
 * has searched more than once), and a collapsible ThinkingTimeline of
 * the reasoning/tool steps. When the answer lands it collapses to
 * "Thought for X.Xs".
 *
 * The live label used to come from a nine-state phase table ("Deciding what to
 * do…", "Cross-checking…"), which was a stand-in for knowing what the agent was
 * actually doing. It now reads the newest step instead (#560) — the tool it just
 * reached for, the routing decision it just made — which is strictly more
 * specific, and falls back to "Thinking…" only before the first step arrives.
 */

/** De-dupes steps by "kind" so the header pill shows each distinct icon once. */
function distinctStepKinds(steps: TurnStep[]): TurnStep[] {
  const seen = new Set<string>();
  const result: TurnStep[] = [];
  for (const step of steps) {
    const key =
      step.kind === "tool"
        ? `tool:${step.tool}`
        : step.kind === "step"
          ? `stage:${step.stage ?? "step"}`
          : step.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }
  return result;
}


export function ThinkingPanel({
  steps: rawSteps,
  phase,
  searchCount,
  active,
  summaryLabel,
  note,
}: {
  steps: TurnStep[];
  phase: TurnPhase;
  searchCount: number;
  active: boolean;
  /**
   * Header text for a finished turn, replacing "Thought for X.Xs". The Inbox
   * passes one because a trace read back from the database has no elapsed-time
   * clock to report (see `stored-trace.ts`).
   */
  summaryLabel?: string;
  /** Footer caveat — withheld reasoning, or a trace clipped on write. */
  note?: string;
}) {
  const steps = chatVisibleSteps(rawSteps);
  const [userOpen, setUserOpen] = useState(false);
  const startRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [thoughtMs, setThoughtMs] = useState<number | null>(null);

  // Anchor the "Thought for X.Xs" timer at mount (i.e. when the turn starts).
  useEffect(() => {
    if (startRef.current === null) startRef.current = Date.now();
  }, []);

  const finished = !active || phase === "done";

  // Stamp "Thought for X.Xs" the first time the turn reaches its answer.
  useEffect(() => {
    if (finished && thoughtMs === null && steps.length > 0) {
      setThoughtMs(Date.now() - (startRef.current ?? Date.now()));
    }
  }, [finished, thoughtMs, steps.length]);

  // Follow the streaming reasoning (#584): the body is height-capped, so while
  // the turn is live it tails its own bottom the way a terminal does —
  // otherwise the newest words stream out of view exactly when they matter.
  useEffect(() => {
    if (!finished && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [finished, steps]);

  // Nothing to show: turn is over and produced no thinking activity
  // (e.g. a verbatim custom-message flow, or a history-loaded message).
  if (steps.length === 0 && finished) return null;

  // Auto-expanded while the agent works (live italic narration, as in the
  // reference), collapsed once done unless the user opens it.
  const open = (userOpen || !finished) && steps.length > 0;
  const seconds = thoughtMs !== null ? (thoughtMs / 1000).toFixed(1) : null;
  const stack = distinctStepKinds(steps).slice(0, 4);
  // One icon and no ×N badge: the pill hugs the icon symmetrically so the
  // glyph sits centered in the border instead of floating in leftover padding.
  const soloIcon = stack.length <= 1 && searchCount <= 1;

  return (
    <div className="max-w-[92%]">
      <button
        type="button"
        onClick={() => setUserOpen(!userOpen)}
        className="flex min-h-7 w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span
          className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border bg-background ${
            soloIcon ? "p-1" : "py-1 pr-2 pl-1"
          }`}
        >
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
              <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground" />
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
        <span className="flex min-w-0 items-center text-sm leading-5 font-medium text-muted-foreground">
          {finished ? (
            (summaryLabel ?? `Thought for ${seconds ?? "a few"}s`)
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              {/* The thinking orb (vendored thinking-orbs) sits between the
                  icon pill and the live label, its animation tracking what
                  the agent is doing: searching for knowledge lookups,
                  connecting for API/DB traffic, working while the answer is
                  being written, solving otherwise. */}
              <ThinkingOrb
                state={liveOrbState(steps)}
                size={20}
                className="shrink-0"
              />
              <ThinkingShimmer className="leading-5">
                {liveTraceLabel(steps)}
              </ThinkingShimmer>
            </span>
          )}
        </span>
        {steps.length > 0 && (
          // The chevron flips by morphing between the two glyphs rather than
          // swapping one for the other (morphicons.com).
          <MorphIcon
            icon={open ? ChevronUp : ChevronDown}
            size={16}
            className="text-muted-foreground/70 ml-auto shrink-0"
          />
        )}
      </button>
      {/* Hidden, not unmounted, when collapsed: the timeline rows keep their
          state across expand/collapse — a ToolResult stays open where the
          reader left it, and each ThoughtRow's per-segment clock survives the
          auto-collapse that lands with the answer. */}
      <div
        ref={bodyRef}
        hidden={!open}
        className="mt-2 max-h-56 overflow-y-auto rounded-2xl border bg-muted/40 px-3 py-2.5"
      >
        <ThinkingTimeline steps={steps} />
        {note && (
          <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground/70">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
