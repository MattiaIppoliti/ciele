import type { TurnStep } from "./types";

/**
 * `AgenticTrace`: the reference platform's turn trace as one flat bracketed
 * string, and the only place we produce or read it (#561).
 *
 * **This is a serialization, never a storage format.** We persist the structured
 * {@link TurnStep} list, which the Thinking panel renders directly and which
 * survives a schema change; the flat string exists so a parser written against a
 * reference export file reads ours unchanged. Everything the reference glues into
 * one blob, the flow name, the reasoning, each tool call and its result, the
 * iteration system note, the end-of-turn follow-ups, is derived here from data
 * we already have.
 *
 * The grammar, in emission order:
 *
 * ```
 * [Workflow started: <flow>] [Thinking: <reasoning>]
 * [Tool: <label + args>] [Result: <output> [System note] …]
 * [Suggested questions: q1, q2] [Workflow completed: <flow>]
 * ```
 *
 * Segments are joined by a single space, and the payloads are free text, which
 * is why {@link parseAgenticTrace} anchors on the marker *vocabulary* rather than
 * on the next `]`: a tool result is rendered YAML/JSON and contains brackets of
 * its own. The one thing that could still forge a boundary is a payload that
 * literally contains `[Tool: `, so {@link serializeAgenticTrace} neutralizes that
 * sequence on the way out. That keeps the round trip total, which is what makes
 * the two representations the same trace rather than two lossy views of it.
 *
 * Notices (`kind: "notice"`) have no counterpart in the reference grammar and are
 * deliberately not serialized: they are our own runtime diagnostics, and inventing
 * a seventh marker would break the drop-in compatibility this format exists for.
 */

/** The six markers the reference grammar defines. */
export type AgenticTraceMarker =
  | "workflow_started"
  | "thinking"
  | "tool"
  | "result"
  | "suggested_questions"
  | "workflow_completed";

/** One bracketed segment: its marker and its raw payload. */
export interface AgenticTraceSegment {
  marker: AgenticTraceMarker;
  text: string;
}

const MARKER_LABELS: Record<AgenticTraceMarker, string> = {
  workflow_started: "Workflow started",
  thinking: "Thinking",
  tool: "Tool",
  result: "Result",
  suggested_questions: "Suggested questions",
  workflow_completed: "Workflow completed",
};

const LABEL_MARKERS = new Map<string, AgenticTraceMarker>(
  Object.entries(MARKER_LABELS).map(([marker, label]) => [
    label,
    marker as AgenticTraceMarker,
  ])
);

/** Matches the start of any segment: `[<known label>: `. */
const SEGMENT_START = new RegExp(
  `\\[(${Object.values(MARKER_LABELS).join("|")}): `,
  "g"
);

/**
 * Rewrites a marker sequence occurring *inside* a payload so it cannot be read
 * back as a segment boundary: `[Tool: ` becomes `(Tool: `. Only the opening
 * bracket moves; it is the one character that could forge a boundary, and the
 * payload's own words are never touched. A payload that merely *ends* in `]`
 * needs nothing: serialize appends its own, and the parser strips exactly one.
 */
function neutralizeMarkers(text: string): string {
  return text.replace(SEGMENT_START, (match) => `(${match.slice(1)}`);
}

export interface SerializeAgenticTraceInput {
  /** The Flow that handled the turn; null when none was recorded. */
  flowName: string | null;
  steps: readonly TurnStep[];
  /** End-of-turn follow-up questions, from the reply's `follow_ups` part. */
  followUps?: readonly string[];
  /**
   * The agent-loop budget the turn ran under, quoted in the `[System note]`.
   * Absent (or a step with no iteration) omits the note rather than guessing a
   * limit the turn was never told about.
   */
  iterationLimit?: number;
  /**
   * Whether the reader may see the model's own reasoning (the Role gate from
   * #557). False drops every `[Thinking:]` segment and keeps the tool timeline,
   * what ran is operational detail; the chain of thought quotes the Visitor and
   * the retrieved knowledge back verbatim. Defaults to true.
   */
  includeReasoning?: boolean;
}

export function serializeAgenticTrace(
  input: SerializeAgenticTraceInput
): string {
  const includeReasoning = input.includeReasoning ?? true;
  const segments: AgenticTraceSegment[] = [];
  const push = (marker: AgenticTraceMarker, text: string) => {
    segments.push({ marker, text: neutralizeMarkers(text) });
  };

  if (input.flowName) push("workflow_started", input.flowName);

  for (const step of input.steps) {
    if (step.kind === "thought") {
      if (includeReasoning) push("thinking", step.label);
      continue;
    }
    if (step.kind !== "tool") continue;
    push("tool", step.label);
    push("result", resultPayload(step, input.iterationLimit));
  }

  const followUps = (input.followUps ?? []).filter((q) => q.trim());
  if (followUps.length > 0) {
    push("suggested_questions", followUps.join(", "));
  }

  if (input.flowName) push("workflow_completed", input.flowName);

  if (segments.length === 0) return "";
  return segments
    .map((s) => `[${MARKER_LABELS[s.marker]}: ${s.text}]`)
    .join(" ");
}

/**
 * One tool call's rendered outcome: the one-line summary, the structured result
 * where the tool recorded one, and the iteration system note the reference embeds
 * inside every result. A call still `running` at persist time never got an
 * outcome, so it says so rather than reading as an empty success.
 */
function resultPayload(step: TurnStep, iterationLimit?: number): string {
  const lines: string[] = [];
  if (step.status === "error") {
    lines.push(`Failed: ${step.detail ?? "the tool call did not complete"}`);
  } else if (step.status === "running") {
    lines.push("No result: the tool call did not complete.");
  } else if (step.detail) {
    lines.push(step.detail);
  }
  if (step.result) {
    try {
      lines.push(JSON.stringify(step.result, null, 2));
    } catch {
      // A result that cannot be serialized is not worth failing an export over.
    }
  }
  if (step.iteration !== undefined && iterationLimit !== undefined) {
    lines.push(
      `[System note] You are now at iteration ${step.iteration} out of ${iterationLimit}.`
    );
  }
  return lines.join("\n");
}

/**
 * Reads a flat `AgenticTrace` back into its segments, ours or the reference's.
 * Boundaries come from the marker vocabulary, so a payload's own brackets stay
 * inside their segment. Text before the first marker, or a string with no markers
 * at all, yields nothing.
 */
export function parseAgenticTrace(source: string): AgenticTraceSegment[] {
  const starts: Array<{ index: number; marker: AgenticTraceMarker; from: number }> =
    [];
  for (const match of source.matchAll(SEGMENT_START)) {
    const marker = LABEL_MARKERS.get(match[1]);
    if (!marker || match.index === undefined) continue;
    starts.push({
      index: match.index,
      marker,
      from: match.index + match[0].length,
    });
  }

  return starts.map((start, i) => {
    const next = starts[i + 1];
    const end = next ? next.index : source.length;
    const raw = source.slice(start.from, end);
    // Segments are `[Marker: payload]` joined by exactly one space, so strip
    // exactly that, the separator then the closing bracket, and nothing more.
    // Trimming whitespace generally would corrupt a payload that legitimately
    // ends in a newline, which `resultPayload` produces whenever a tool's
    // structured result or system note lands last.
    const withoutSeparator = raw.endsWith("] ") ? raw.slice(0, -1) : raw;
    return {
      marker: start.marker,
      text: withoutSeparator.endsWith("]")
        ? withoutSeparator.slice(0, -1)
        : withoutSeparator,
    };
  });
}
