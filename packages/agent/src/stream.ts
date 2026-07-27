import type { ChatReplyPart } from "./types";
import type { RuntimeEvent, StepStage } from "./types";

/**
 * Client side of the RuntimeEvent wire contract (one JSON event per line,
 * emitted by the Conversation Turn module). Both chat clients — the public
 * Widget and the admin Preview — consume a turn through this seam, so the
 * event schema and the folding rules live in exactly two places: turn.ts
 * (producer) and here (consumer). This module is client-safe: type-only
 * imports, no server dependencies.
 */

/** One Thinking-panel entry, folded from the step/thought/tool-* events. */
export interface TurnStep {
  /** tool-* events carry the AI-SDK toolCallId; other kinds get a local id. */
  id: string;
  kind: "step" | "thought" | "tool";
  label: string;
  /** Registry tool name, for `kind: "tool"`. */
  tool?: string;
  /** Engine stage, for `kind: "step"` — lets the UI pick a stage-specific icon. */
  stage?: StepStage;
  /** Tool calls run until their tool-end arrives; other kinds are done. */
  status: "running" | "done" | "error";
  /** Model-supplied call arguments, for `kind: "tool"` (already safe to show — see tool-start). */
  input?: Record<string, unknown>;
  /** Outcome summary from the tool-end event ("3 concepts found"). */
  detail?: string;
  durationMs?: number;
}

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

/** The turn state both chat UIs render while a reply streams in. */
export interface TurnView {
  flowName: string | null;
  steps: TurnStep[];
  parts: ChatReplyPart[];
  streamingText: string | null;
  phase: TurnPhase;
  /** Knowledge searches run so far (the ×N pill in the Thinking panel). */
  searchCount: number;
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
 * Folds a turn's RuntimeEvents into the TurnView: Thinking Steps accumulate,
 * parts append, text deltas stream into `streamingText` and solidify into a
 * text part on `text-end`, `error` degrades to a fallback part.
 */
export async function consumeTurnStream<T extends TurnView>(
  body: ReadableStream<Uint8Array>,
  options: ConsumeTurnOptions<T>
): Promise<void> {
  const { update, onStart, onDone } = options;
  const errorText =
    options.errorText ?? (() => "Something went wrong — please try again.");
  let streamAction = "search_knowledge";
  let stepSeq = 0;

  for await (const event of decodeRuntimeEvents(body)) {
    switch (event.type) {
      case "turn":
        onStart?.({ conversationId: event.conversationId });
        break;
      case "flow":
        // Annotate the classify step that produced this decision, so its
        // Thinking-panel row can expand to show which flow matched.
        update((view) => ({
          ...view,
          flowName: event.flowName,
          steps: view.steps.map((step, i) =>
            i === view.steps.length - 1 &&
            step.kind === "step" &&
            step.stage === "classify" &&
            !step.detail
              ? { ...step, detail: `Matched flow “${event.flowName}”` }
              : step
          ),
        }));
        break;
      case "step":
        update((view) => {
          let phase = view.phase;
          let searchCount = view.searchCount;
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
            ...view,
            steps: [
              ...view.steps,
              {
                id: `step-${++stepSeq}`,
                kind: "step" as const,
                label: event.label,
                stage: event.stage,
                status: "done" as const,
                detail: event.detail,
              },
            ],
            phase,
            searchCount,
          };
        });
        break;
      case "tool-start":
        update((view) => {
          // The knowledge tool drives the same searching/crosschecking phase
          // the deterministic engine's "search" step stage used to.
          let phase = view.phase;
          let searchCount = view.searchCount;
          if (event.tool === "searchKnowledge") {
            searchCount += 1;
            phase = searchCount > 1 ? "crosschecking" : "searching";
          }
          return {
            ...view,
            steps: [
              ...view.steps,
              {
                id: event.callId,
                kind: "tool" as const,
                tool: event.tool,
                label: event.label,
                input: event.input,
                status: "running" as const,
              },
            ],
            phase,
            searchCount,
          };
        });
        break;
      case "tool-end":
        update((view) => ({
          ...view,
          steps: view.steps.map((step) =>
            step.id === event.callId
              ? {
                  ...step,
                  status: event.ok ? ("done" as const) : ("error" as const),
                  detail: event.summary,
                  durationMs: event.durationMs,
                }
              : step
          ),
          phase: event.tool === "searchKnowledge" ? "reading" : view.phase,
        }));
        break;
      case "thought":
        // Reasoning that led into a tool call: what was streaming as answer
        // text moves into the Thinking panel and the answer bubble resets.
        update((view) => ({
          ...view,
          steps: [
            ...view.steps,
            {
              id: `step-${++stepSeq}`,
              kind: "thought" as const,
              label: event.text,
              status: "done" as const,
            },
          ],
          streamingText: null,
          phase: "thinking",
        }));
        break;
      case "part":
        update((view) => ({ ...view, parts: [...view.parts, event.part] }));
        break;
      case "text-start":
        streamAction = event.action;
        // After a search, streamed text is the answer ("Thought for X.Xs");
        // before any search it may still be pre-tool reasoning, so the phase
        // stays "thinking" until a thought/tool call or text-end resolves it.
        update((view) => ({
          ...view,
          streamingText: "",
          phase: view.searchCount > 0 ? "answering" : "thinking",
        }));
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
          phase: "answering",
        }));
        break;
      case "done":
        update((view) => ({ ...view, phase: "done" }));
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
