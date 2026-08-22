import type { TurnStep, TurnTerminalStatus } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";
import type { RuntimeEvent } from "./types";
import { parsePartialJson } from "./partial-json";
import { stripNonProps } from "./reply-components";

/**
 * The RuntimeEvent wire contract's consumer side (one JSON event per line,
 * emitted by the Conversation Turn module). Everything derived from a turn's
 * notice/thought/tool-* events is folded by {@link foldTraceEvent}, the SINGLE
 * folding rule, shared by all three consumers: the public Widget, the admin
 * Preview, and turn.ts itself, which folds the events it is emitting in order
 * to persist the trace. A second fold would be a second source of truth for
 * what the Thinking panel shows.
 *
 * The fold is pure and client-safe (type-only imports, no server
 * dependencies); the streaming/answer-assembly concerns that only a live client
 * has, text deltas, reply parts, error copy, stay in
 * {@link consumeTurnStream} around it.
 */

export type { TurnStep };

/**
 * Whether the turn is still working or has reached its answer, the only phase
 * distinction a chat UI needs, since it decides whether the Thinking panel spins
 * and stays open or collapses to its summary.
 *
 * It used to be a nine-state machine whose labels ("Deciding what to do…",
 * "Preparing to search…", "Cross-checking…") stood in for knowing what the agent
 * was actually doing. It no longer has to guess: the tool lifecycle names the
 * tool, the reasoning thoughts say why, and Simplified thinking narrates the
 * phase in the Visitor's own words (#560). The panel reads its live label off the
 * newest step instead, which is strictly more specific than any label table.
 */
export type TurnPhase = "running" | "done";

/**
 * Everything {@link foldTraceEvent} derives from a turn's events: the Thinking
 * Steps, which Flow handled the turn, the search counter behind the ×N pill,
 * and whether the turn is still running. {@link TurnView} is a superset, so a
 * client folds by spreading the result over its view.
 */
export interface TurnTrace {
  flowName: string | null;
  steps: TurnStep[];
  phase: TurnPhase;
  /** Knowledge searches run so far (the ×N pill in the Thinking panel). */
  searchCount: number;
  /**
   * The agent-loop iteration most recently spent, out of `iterationLimit`
   * (#574). Both stay null on turns with no budget (verbatim/no-model paths).
   */
  iteration: number | null;
  iterationLimit: number | null;
  /** The terminal status the loop declared via ReadyToAnswer, once it has. */
  terminal: TurnTerminalStatus | null;
}

/** A turn before any event has arrived. */
export const EMPTY_TURN_TRACE: TurnTrace = {
  flowName: null,
  steps: [],
  phase: "running",
  searchCount: 0,
  iteration: null,
  iterationLimit: null,
  terminal: null,
};

/**
 * The one exception to append-only steps: the newest step, when it is the
 * thought still being streamed (#584). Deltas rewrite its label in place and
 * the terminal `thought` settles it; with no running thought (older streams,
 * stored traces, the first delta of a burst) the thought is appended instead.
 */
function foldThought(
  trace: TurnTrace,
  status: "running" | "done",
  label: (prev: string | null) => string
): TurnTrace {
  const last = trace.steps[trace.steps.length - 1];
  if (last?.kind === "thought" && last.status === "running") {
    return {
      ...trace,
      steps: trace.steps.map((step) =>
        step === last ? { ...step, label: label(step.label), status } : step
      ),
    };
  }
  return {
    ...trace,
    steps: [
      ...trace.steps,
      {
        id: `step-${trace.steps.length + 1}`,
        kind: "thought",
        label: label(null),
        status,
      },
    ],
  };
}

/**
 * Folds one wire event into the turn's trace. Pure, total (an event it does not
 * care about returns the trace unchanged) and append-only on `steps` (except
 * the streaming thought, see {@link foldThought}), which is what makes
 * `steps.length` a safe id for the kinds that have no call id.
 *
 * The running/done transition lives here rather than in the clients so the panel
 * contents and the persisted trace can never disagree about what the agent did.
 */
/**
 * The projection of a RuntimeEvent that is safe to send to a chat client.
 *
 * `tool-end` carries two tiers (see its type): `result`, safe for any audience,
 * and `operatorResult`, which may hold an upstream response body or an absolute
 * internal URL. The widget chat route returns the event stream verbatim to an
 * anonymous caller, so the operator tier is dropped here. Call this on the way
 * out, after {@link foldTraceEvent} has taken what the stored trace needs.
 */
/**
 * Which tier the stored trace keeps: the operator record when the tool declared
 * one, otherwise the shown record. Never a leak, because `turn.ts` strips
 * `operatorResult` on the way to a client; this only keeps the stored copy whole.
 */
function storedResult(
  event: Extract<RuntimeEvent, { type: "tool-end" }>
): Record<string, unknown> | undefined {
  return event.operatorResult ?? event.result;
}

export function publicRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  if (event.type !== "tool-end" || event.operatorResult === undefined) {
    return event;
  }
  const { operatorResult: _operatorResult, ...rest } = event;
  return rest;
}

export function foldTraceEvent(trace: TurnTrace, event: RuntimeEvent): TurnTrace {
  switch (event.type) {
    case "flow":
      return { ...trace, flowName: event.flowName };
    case "notice":
      return {
        ...trace,
        steps: [
          ...trace.steps,
          {
            id: `step-${trace.steps.length + 1}`,
            kind: "notice",
            label: event.label,
            status: "done",
            detail: event.detail,
          },
        ],
      };
    case "tool-start": {
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
        // The ×N pill counts knowledge searches specifically; that is the
        // number an operator reads as "how hard did this turn look".
        searchCount:
          event.tool === "searchKnowledge"
            ? trace.searchCount + 1
            : trace.searchCount,
        // Iterations only ever grow, and the budget rides along with them, so
        // the panel can say `iteration N/M` (#574).
        iteration: event.iteration ?? trace.iteration,
        iterationLimit: event.iterationLimit ?? trace.iterationLimit,
      };
    }
    case "tool-end": {
      // The operator tier when the tool declared one: this fold is what turn.ts
      // persists and the Inbox card renders, so it takes the undiminished
      // record. A live client never receives `operatorResult` (turn.ts strips
      // it), so folding it here cannot leak, it only keeps the stored copy
      // complete.
      const stored = storedResult(event);
      return {
        ...trace,
        steps: trace.steps.map((step) =>
          step.id === event.callId
            ? {
                ...step,
                status: event.ok ? "done" : "error",
                detail: event.summary,
                ...(stored ? { result: stored } : {}),
                durationMs: event.durationMs,
              }
            : step
        ),
        // The terminal tool's structured result carries the FINAL declared
        // status (post any re-clarify coercion), the fold reads it here so
        // the persisted trace and the Inbox badge agree with the write phase.
        terminal:
          event.tool === "readyToAnswer" &&
          typeof event.result?.status === "string"
            ? (event.result.status as TurnTerminalStatus)
            : trace.terminal,
      };
    }
    case "thought-delta":
      // Live reasoning (#584): deltas grow the newest running thought step in
      // place, so the panel streams the text exactly where the finalized step
      // will sit, interleaved with the tool cards, not in the answer bubble.
      return foldThought(trace, "running", (prev) => (prev ?? "") + event.delta);
    case "thought":
      // Reasoning that led into a tool call, whole and authoritative: it
      // finalizes the running step its deltas built, replacing the accumulated
      // label with the trimmed text so a delta-built trace and a stored one
      // hold the identical step. Without a running step (older streams, stored
      // traces) it appends, what was streaming as answer text moves into the
      // Thinking panel (the client resets its bubble).
      return foldThought(trace, "done", () => event.text);
    case "text-start":
      // After a search, streamed text is the answer, so the panel settles into
      // its summary; before any search it may still be pre-tool reasoning that a
      // `thought` event will reclassify, so the turn stays running.
      return trace.searchCount > 0 ? { ...trace, phase: "done" } : trace;
    case "text-end":
    case "done":
      return { ...trace, phase: "done" };
    default:
      return trace;
  }
}

/**
 * Where a component part for `callId` sits, or -1. Components are the only
 * parts a client rewrites in place, and the tool-call id is what identifies
 * one across the provisional render and the validated part that replaces it.
 */
function componentIndex(parts: readonly ChatReplyPart[], callId: string): number {
  return parts.findIndex(
    (part) => part.type === "component" && part.callId === callId
  );
}

/**
 * Appends a part, except a component that is already on screen as a
 * provisional render: that one is replaced, so the validated props supersede
 * whatever the streamed arguments last parsed to and `pending` clears.
 */
export function appendOrReplacePart(
  parts: readonly ChatReplyPart[],
  part: ChatReplyPart
): ChatReplyPart[] {
  if (part.type !== "component") return [...parts, part];
  const at = componentIndex(parts, part.callId);
  if (at < 0) return [...parts, part];
  return parts.map((existing, index) => (index === at ? part : existing));
}

/**
 * Rewrites a provisional component's props from the arguments streamed so far.
 * A no-op once the validated part has landed (`pending` cleared), so a late
 * delta can never walk back a finished component.
 */
export function updatePendingComponent(
  parts: ChatReplyPart[],
  callId: string,
  props: Record<string, unknown>
): ChatReplyPart[] {
  const at = componentIndex(parts, callId);
  if (at < 0) return parts;
  const existing = parts[at];
  // Returning the SAME array on a no-op, not a copy: deltas arrive per token
  // and most of them change nothing the parse can use, so a fresh array would
  // re-render the whole reply for every one of them.
  if (existing.type !== "component" || !existing.pending) return parts;
  return parts.map((part, index) =>
    index === at ? { ...existing, props } : part
  );
}

/**
 * Drops provisional components that never became real ones: the one for
 * `callId`, or every one still pending when no id is given. Leaving a skeleton
 * up would promise a component that is not coming.
 *
 * The per-call case is a call that never reached its tool: the AI SDK validates
 * arguments against the input schema before execute, so a malformed or over-cap
 * payload runs no tool at all. `gather-phase.ts` turns that `tool-error` chunk
 * into a `tool-end`, which is what identifies the dead call.
 *
 * The sweep-everything case covers the ways a turn ends with no such signal: a
 * model that abandons a call it started writing, an aborted fetch, a dropped
 * connection.
 */
export function dropPendingComponents(
  parts: readonly ChatReplyPart[],
  callId?: string
): ChatReplyPart[] {
  return parts.filter(
    (part) =>
      !(
        part.type === "component" &&
        part.pending &&
        (callId === undefined || part.callId === callId)
      )
  );
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
 * client needs on top, reply parts append, text deltas stream into
 * `streamingText` and solidify into a text part on `text-end`, and `error`
 * degrades to a fallback part.
 */
export async function consumeTurnStream<T extends TurnView>(
  body: ReadableStream<Uint8Array>,
  options: ConsumeTurnOptions<T>
): Promise<void> {
  const { update, onStart, onDone } = options;
  const errorText =
    options.errorText ?? (() => "Something went wrong, please try again.");
  let streamAction = "search_knowledge";
  // Argument JSON accumulated per render-only call. Live-client state, which is
  // why it lives here rather than in the fold: the persisted trace takes its
  // component from the validated `part`, never from a partial parse.
  const streamingProps = new Map<string, string>();

  // Wrapped so NOTHING provisional outlives this consumer, whichever way it
  // returns. `done` and `error` sweep on their own below, but an aborted fetch
  // or a dropped connection throws straight out of the iterator, and the
  // widget's catch swallows that, so a skeleton left behind would pulse in the
  // transcript for the rest of the session.
  try {
    for await (const event of decodeRuntimeEvents(body)) {
      // The shared fold first, for every event, then the streaming-only extras.
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
          update((view) => ({
            ...view,
            parts: appendOrReplacePart(view.parts, event.part),
          }));
          break;
        case "tool-input-start": {
          // The component goes up empty and grows. Props arrive as argument
          // deltas, which some providers never send (see the event's docs), so
          // this may be the only frame before the validated part lands.
          streamingProps.set(event.callId, "");
          const skeleton: ChatReplyPart = {
            type: "component",
            action: "search_knowledge",
            name: event.name,
            props: {},
            callId: event.callId,
            pending: true,
          };
          update((view) => ({
            ...view,
            parts: appendOrReplacePart(view.parts, skeleton),
          }));
          break;
        }
        case "tool-input-delta": {
          const text = (streamingProps.get(event.callId) ?? "") + event.delta;
          streamingProps.set(event.callId, text);
          const props = parsePartialJson(text);
          // Nothing coherent yet: keep the last render rather than blanking it.
          if (!props || typeof props !== "object" || Array.isArray(props)) break;
          update((view) => ({
            ...view,
            parts: updatePendingComponent(
              view.parts,
              event.callId,
              // The Simplified-thinking line rides the same argument JSON, and it
              // is narration, not a prop.
              stripNonProps(props as Record<string, unknown>)
            ),
          }));
          break;
        }
        case "tool-end":
          // Either the render tool ran and emitted its part (swapped in by the
          // `part` case above), or the call died before reaching the tool and
          // `gather-phase` reported it here. Anything still pending is not
          // arriving.
          if (streamingProps.has(event.callId)) {
            streamingProps.delete(event.callId);
            update((view) => ({
              ...view,
              parts: dropPendingComponents(view.parts, event.callId),
            }));
          }
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
          // Backstop: schema validation runs before execute, so a rejected
          // payload yields no tool-end to clean up after. Nothing is still
          // arriving once the turn is done.
          if (streamingProps.size > 0) {
            streamingProps.clear();
            update((view) => ({
              ...view,
              parts: dropPendingComponents(view.parts),
            }));
          }
          onDone?.({
            conversationId: event.conversationId,
            messageId: event.messageId,
          });
          break;
        case "error":
          // Same backstop as `done`: the turn is over, so nothing still pending
          // is going to arrive, and the fallback goes where the component was.
          streamingProps.clear();
          update((view) => ({
            ...view,
            parts: [
              ...dropPendingComponents(view.parts),
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
  } finally {
    if (streamingProps.size > 0) {
      streamingProps.clear();
      update((view) => ({
        ...view,
        parts: dropPendingComponents(view.parts),
      }));
    }
  }
}
