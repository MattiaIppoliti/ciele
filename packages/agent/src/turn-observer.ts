import {
  EMPTY_TURN_TRACE,
  foldTraceEvent,
  publicRuntimeEvent,
  type TurnTrace,
} from "./stream";
import type { ChatReplyPart, RuntimeEvent } from "./types";

type AuditedCall = {
  tool: string;
  label: string;
  ok: boolean;
  summary?: string;
};

/**
 * Observes one model-backed turn for every adapter that streams it.
 *
 * The stored trace keeps the operator result, while the forwarded event is the
 * public projection safe for a Visitor or Member. Tool counts and the durable
 * audit part are derived from the same event fold, so adapters cannot disagree
 * about what the model did.
 */
export function createTurnObserver(
  forward: (event: RuntimeEvent) => void,
): {
  emit: (event: RuntimeEvent) => void;
  readonly trace: TurnTrace;
  readonly toolCalls: number;
  partsWithAudit: (parts: readonly ChatReplyPart[]) => ChatReplyPart[];
} {
  let trace = EMPTY_TURN_TRACE;
  let toolCalls = 0;
  const auditedCalls = new Map<string, AuditedCall>();

  return {
    emit(event) {
      if (event.type === "tool-start") {
        toolCalls += 1;
        auditedCalls.set(event.callId, {
          tool: event.tool,
          label: event.label,
          ok: false,
        });
      } else if (event.type === "tool-end") {
        const call = auditedCalls.get(event.callId);
        if (call) {
          call.ok = event.ok;
          if (event.summary) call.summary = event.summary;
        }
      }
      trace = foldTraceEvent(trace, event);
      forward(publicRuntimeEvent(event));
    },
    get trace() {
      return trace;
    },
    get toolCalls() {
      return toolCalls;
    },
    partsWithAudit(parts) {
      return auditedCalls.size === 0
        ? [...parts]
        : [
            ...parts,
            { type: "tool_calls", calls: [...auditedCalls.values()] },
          ];
    },
  };
}
