import type { TurnStep } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";
import type { RuntimeEvent } from "./types";

/**
 * The RuntimeEvent wire contract's consumer side (one JSON event per line,
 * emitted by the Conversation Turn module). Everything derived from a turn's
 * step/thought/tool-* events is folded by {@link foldTraceEvent} — the SINGLE
 * folding rule, shared by all three consumers: the public Widget, the admin
 * Preview, and turn.ts itself, which folds the events it is emitting in order
 * to persist the trace. A second fold would be a second source of truth for
 * what the Thinking panel shows.
 *
 * The fold is pure and client-safe (type-only imports, no server
 * dependencies); the streaming/answer-assembly concerns that only a live client
 * has — text deltas, reply parts, error copy — stay in
 * {@link consumeTurnStream} around it.
 */

export type { TurnStep };

/**
 * Where the turn currently is in the agent loop; the chat UIs map this to the
 * status label ("Thinking…" → "Deciding what to do…" → "Preparing to search…"
 * → "Looking into it…" → "Gathering info…" → "Cross-checking…" → "Thought for
 * X.Xs"). Folded here from the step stages so both UIs agree.
 */
export type TurnPhase =
  | "starting"
  | "deciding"
  | "preparing"
  | "thinking"
  | "searching"
  | "crosschecking"
  | "reading"
  | "answering"
  | "done";

/**
 * Everything {@link foldTraceEvent} derives from a turn's events: the Thinking
 * Steps, which Flow handled the turn, the search counter behind the ×N pill,
 * and the display phase. {@link TurnView} is a superset, so a client folds by
 * spreading the result over its view.
 */
export interface TurnTrace {
  flowName: string | null;
  steps: TurnStep[];
  phase: TurnPhase;
  /** Knowledge searches run so far (the ×N pill in the Thinking panel). */
  searchCount: number;
}

/** A turn before any event has arrived. */
export const EMPTY_TURN_TRACE: TurnTrace = {
  flowName: null,
  steps: [],
  phase: "starting",
  searchCount: 0,
};

/**
 * Folds one wire event into the turn's trace. Pure, total (an event it does not
 * care about returns the trace unchanged) and append-only on `steps`, which is
 * what makes `steps.length` a safe id for the kinds that have no call id.
 *
 * The phase transitions live here rather than in the clients so the status
 * label, the panel contents and the persisted trace can never disagree about
 * what the agent was doing.
 */
export function foldTraceEvent(trace: TurnTrace, event: RuntimeEvent): TurnTrace {
  switch (event.type) {
    case "flow":
      // Annotate the classify step that produced this decision, so its
      // Thinking-panel row can expand to show which flow matched.
      return {
        ...trace,
        flowName: event.flowName,
        steps: trace.steps.map((step, i) =>
          i === trace.steps.length - 1 &&
          step.kind === "step" &&
          step.stage === "classify" &&
          !step.detail
            ? { ...step, detail: `Matched flow “${event.flowName}”` }
            : step
        ),
      };
    case "step": {
      let phase = trace.phase;
      let searchCount = trace.searchCount;
      switch (event.stage) {
        case "classify":
          phase = "deciding";
          break;
        case "generate":
          phase = "preparing";
          break;
        case "search":
          searchCount += 1;
          phase = searchCount > 1 ? "crosschecking" : "searching";
          break;
        case "found":
          phase = "reading";
          break;
      }
      return {
        ...trace,
        steps: [
          ...trace.steps,
          {
            id: `step-${trace.steps.length + 1}`,
            kind: "step",
            label: event.label,
            stage: event.stage,
            status: "done",
            detail: event.detail,
          },
        ],
        phase,
        searchCount,
      };
    }
    case "tool-start": {
      // The knowledge tool drives the same searching/crosschecking phase
      // the deterministic engine's "search" step stage used to.
      let phase = trace.phase;
      let searchCount = trace.searchCount;
      if (event.tool === "searchKnowledge") {
        searchCount += 1;
        phase = searchCount > 1 ? "crosschecking" : "searching";
      }
      return {
        ...trace,
        steps: [
          ...trace.steps,
          {
            id: event.callId,
            kind: "tool",
            tool: event.tool,
            label: event.label,
            input: event.input,
            status: "running",
            iteration: event.iteration,
          },
        ],
        phase,
        searchCount,
      };
    }
    case "tool-end":
      return {
        ...trace,
        steps: trace.steps.map((step) =>
          step.id === event.callId
            ? {
                ...step,
                status: event.ok ? "done" : "error",
                detail: event.summary,
                ...(event.result ? { result: event.result } : {}),
                durationMs: event.durationMs,
              }
            : step
        ),
        phase: event.tool === "searchKnowledge" ? "reading" : trace.phase,
      };
    case "thought":
      // Reasoning that led into a tool call: what was streaming as answer
      // text moves into the Thinking panel (the client resets its bubble).
      return {
        ...trace,
        steps: [
          ...trace.steps,
          {
            id: `step-${trace.steps.length + 1}`,
            kind: "thought",
            label: event.text,
            status: "done",
          },
        ],
        phase: "thinking",
      };
    case "text-start":
      // After a search, streamed text is the answer ("Thought for X.Xs");
      // before any search it may still be pre-tool reasoning, so the phase
      // stays "thinking" until a thought/tool call or text-end resolves it.
      return {
        ...trace,
        phase: trace.searchCount > 0 ? "answering" : "thinking",
      };
    case "text-end":
      return { ...trace, phase: "answering" };
    case "done":
      return { ...trace, phase: "done" };
    default:
      return trace;
  }
}

/** The turn state both chat UIs render while a reply streams in. */
export interface TurnView extends TurnTrace {
  parts: ChatReplyPart[];
  streamingText: string | null;
}

/** Decodes an ndjson body into RuntimeEvents, buffering partial lines. */
export async function* decodeRuntimeEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<RuntimeEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      yield JSON.parse(line) as RuntimeEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as RuntimeEvent;
}

export interface ConsumeTurnOptions<T extends TurnView> {
  /** Applies a functional update to the in-flight bot message. */
  update: (fn: (view: T) => T) => void;
  /** Fires as soon as the server has resolved the turn's conversation. */
  onStart?: (start: { conversationId: string }) => void;
  /** Fires on the final `done` event with the persisted ids. */
  onDone?: (done: { conversationId: string; messageId: string | null }) => void;
  /** Renders the fallback text for an `error` event (default: generic). */
  errorText?: (message: string) => string;
}

/**
 * Consumes a turn into the TurnView: {@link foldTraceEvent} owns the Thinking
 * Steps, flow name, search count and phase; this loop adds only what a live
 * client needs on top — reply parts append, text deltas stream into
 * `streamingText` and solidify into a text part on `text-end`, and `error`
 * degrades to a fallback part.
 */
export async function consumeTurnStream<T extends TurnView>(
  body: ReadableStream<Uint8Array>,
  options: ConsumeTurnOptions<T>
): Promise<void> {
  const { update, onStart, onDone } = options;
  const errorText =
    options.errorText ?? (() => "Something went wrong — please try again.");
  let streamAction = "search_knowledge";

  for await (const event of decodeRuntimeEvents(body)) {
    // The shared fold first, for every event — then the streaming-only extras.
    update((view) => ({ ...view, ...foldTraceEvent(view, event) }));
    switch (event.type) {
      case "turn":
        onStart?.({ conversationId: event.conversationId });
        break;
      case "thought":
        // The reasoning moved into the Thinking panel, so the bubble resets.
        update((view) => ({ ...view, streamingText: null }));
        break;
      case "part":
        update((view) => ({ ...view, parts: [...view.parts, event.part] }));
        break;
      case "text-start":
        streamAction = event.action;
        update((view) => ({ ...view, streamingText: "" }));
        break;
      case "text-delta":
        update((view) => ({
          ...view,
          streamingText: (view.streamingText ?? "") + event.delta,
        }));
        break;
      case "text-end":
        update((view) => ({
          ...view,
          parts: [
            ...view.parts,
            {
              type: "text",
              action: streamAction,
              text: view.streamingText ?? "",
            } as ChatReplyPart,
          ],
          streamingText: null,
        }));
        break;
      case "done":
        onDone?.({
          conversationId: event.conversationId,
          messageId: event.messageId,
        });
        break;
      case "error":
        update((view) => ({
          ...view,
          parts: [
            ...view.parts,
            {
              type: "text",
              action: "fallback",
              text: errorText(event.message),
            } as ChatReplyPart,
          ],
        }));
        break;
    }
  }
}
