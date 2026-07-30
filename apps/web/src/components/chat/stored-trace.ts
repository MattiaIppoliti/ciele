import type { StoredTurnTrace, TurnStep } from "@agent-hub/core";

/**
 * Projects a persisted turn trace into what the Thinking panel should render
 * for the Member looking at it. Pure so it can be tested directly — the panel
 * itself is a `.tsx` component and this app's vitest only picks up `.ts`.
 *
 * The gate drops the model's own reasoning (`kind: "thought"`) and keeps the
 * tool timeline: what ran, with what input, and how it went is operational
 * detail every Inbox reader needs, while the chain-of-thought quotes the
 * Visitor's message and the retrieved knowledge back verbatim (see
 * `canViewReasoning`). `hiddenThoughts` lets the panel say something was
 * withheld rather than silently showing a shorter turn than the one that ran.
 */
export interface VisibleTrace {
  steps: TurnStep[];
  searchCount: number;
  truncated: boolean;
  /** Reasoning steps the Role gate removed. */
  hiddenThoughts: number;
}

export function visibleTraceSteps(
  trace: StoredTurnTrace | null | undefined,
  options: { canViewReasoning: boolean }
): VisibleTrace | null {
  if (!trace || trace.steps.length === 0) return null;
  const steps = options.canViewReasoning
    ? trace.steps
    : trace.steps.filter((step) => step.kind !== "thought");
  // Every step was reasoning and the reader may not see reasoning: there is no
  // panel to show, only a count worth admitting to.
  return {
    steps,
    searchCount: trace.searchCount,
    truncated: trace.truncated ?? false,
    hiddenThoughts: trace.steps.length - steps.length,
  };
}

/**
 * The panel header for a finished, stored turn. The live panel counts elapsed
 * time as it streams; a trace read back from the database has no such clock, so
 * it reports what it knows — how much work the turn did — the way the reference
 * platform's transcript does.
 */
export function storedTraceLabel(trace: VisibleTrace): string {
  const tools = trace.steps.filter((step) => step.kind === "tool").length;
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} ${tools === 1 ? "tool call" : "tool calls"}`);
  const thoughts = trace.steps.filter((step) => step.kind === "thought").length;
  if (thoughts > 0) parts.push(`${thoughts} ${thoughts === 1 ? "thought" : "thoughts"}`);
  if (parts.length === 0) return "Thought";
  return `Thought · ${parts.join(", ")}`;
}

/** Longest live label before it is clipped — a header line, not a paragraph. */
const LIVE_LABEL_MAX = 64;

/**
 * The panel header for a turn still in flight: what the agent is doing right
 * now, taken from the newest **tool** step.
 *
 * This replaced a nine-state phase-label table ("Deciding what to do…",
 * "Cross-checking…") whose labels only described where the loop was (#560).
 * Naming the running tool is strictly more specific, and it cannot drift from
 * what the panel below it lists.
 *
 * **Only tool steps.** A tool label is written to be read — "Searching knowledge
 * for 'fees'". The other two kinds are not: a `thought`'s label is the model's
 * raw reasoning, which reads as gibberish clipped at 64 characters and does not
 * belong in a collapsed header a Visitor sees; a `notice`'s label is an operator
 * diagnostic ("No AI provider credential configured for this organization — add
 * one in Settings → AI") that is addressed to an admin, not to whoever is waiting
 * for an answer. Both still appear as rows in the expanded panel, which is where
 * they make sense. Between tool calls the header says "Thinking…".
 *
 * A tool label may be multi-line (a batched knowledge search lists its queries),
 * so only its first line reaches the header; the expanded timeline has the rest.
 */
export function liveTraceLabel(steps: TurnStep[]): string {
  const newest = [...steps].reverse().find((step) => step.kind === "tool");
  const line = newest?.label.split("\n")[0].trim();
  if (!line) return "Thinking…";
  const clipped =
    line.length > LIVE_LABEL_MAX ? `${line.slice(0, LIVE_LABEL_MAX)}…` : line;
  return /[….!?:]$/.test(clipped) ? clipped : `${clipped}…`;
}
