import {
  TRACE_MAX_DETAIL_CHARS,
  TRACE_MAX_INPUT_CHARS,
  TRACE_MAX_LABEL_CHARS,
  TRACE_MAX_RESULT_CHARS,
  TRACE_MAX_STEPS,
  type StoredTurnTrace,
  type TurnStep,
} from "@agent-hub/core";
import { redactBearerSecrets } from "./redact";
import type { TurnTrace } from "./stream";

/**
 * Prepares a live turn trace for storage. The trace is clipped on WRITE, never
 * on read: reasoning text is unbounded by nature (a single reference-platform
 * turn ran to 108k characters) and a Conversation holds many turns, so the row
 * has to be bounded before it lands.
 *
 * Three things happen here and nowhere else:
 *  1. **Caps** — step count and per-step text, with `truncated` set so a
 *     clipped trace reads as clipped rather than as a turn that did less work.
 *     The FIRST steps are kept: they are the ones that explain how the turn
 *     started reasoning, which is what an auditor reads first.
 *  2. **Redaction** — every stored string goes through
 *     {@link redactBearerSecrets}. Tool inputs are already safe to show (the
 *     registry only ever puts model-supplied arguments on the wire), but a tool
 *     that echoes an `Authorization` header into its outcome summary must not
 *     turn the Inbox into a credential viewer.
 *  3. **Unresolved calls settle** — a step still `running` at persist time is a
 *     tool call whose end never arrived (an aborted or crashed turn). Stored as
 *     `error`, so the Inbox shows a call that failed instead of a spinner that
 *     never stops.
 *
 * Returns null when the turn produced no steps — a verbatim `custom_message`
 * Flow Action or a proactive Notification does no agentic work, and an empty
 * trace row would only make the Inbox render an empty panel.
 */
export function prepareTraceForStorage(trace: TurnTrace): StoredTurnTrace | null {
  if (trace.steps.length === 0) return null;

  let truncated = trace.steps.length > TRACE_MAX_STEPS;
  const kept = trace.steps.slice(0, TRACE_MAX_STEPS);

  const clip = (text: string, max: number): string => {
    const safe = redactBearerSecrets(text);
    if (safe.length <= max) return safe;
    truncated = true;
    return `${safe.slice(0, max)}…`;
  };

  const steps: TurnStep[] = kept.map((step) => {
    const next: TurnStep = {
      ...step,
      label: clip(step.label, TRACE_MAX_LABEL_CHARS),
      status: step.status === "running" ? "error" : step.status,
    };
    if (step.detail !== undefined) {
      next.detail = clip(step.detail, TRACE_MAX_DETAIL_CHARS);
    }
    if (step.input !== undefined) {
      next.input = clipObject(step.input, TRACE_MAX_INPUT_CHARS, "input", () => {
        truncated = true;
      });
    }
    if (step.result !== undefined) {
      next.result = clipObject(
        step.result,
        TRACE_MAX_RESULT_CHARS,
        "result",
        () => {
          truncated = true;
        }
      );
    }
    return next;
  });

  return {
    steps,
    searchCount: trace.searchCount,
    truncated,
    // The loop counters and the terminal declaration (#574) — copied only when
    // the turn actually had them, so a no-budget turn stores no misleading 0/0.
    ...(trace.iteration !== null ? { iteration: trace.iteration } : {}),
    ...(trace.iterationLimit !== null
      ? { iterationLimit: trace.iterationLimit }
      : {}),
    ...(trace.terminal !== null ? { terminal: trace.terminal } : {}),
  };
}

/**
 * Redacts and bounds one of a step's structured objects — the model-supplied
 * input, or a tool's structured result. Serializing to measure is deliberate:
 * the cap that matters is the size of the stored row, and a per-field cap would
 * let a wide object through under any per-string limit. An object that cannot be
 * serialized at all (a cycle, a BigInt) is dropped rather than failing the turn
 * that already answered.
 */
function clipObject(
  value: Record<string, unknown>,
  max: number,
  label: string,
  onTruncate: () => void
): Record<string, unknown> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    onTruncate();
    return { note: `${label} could not be stored` };
  }
  if (serialized.length > max) {
    onTruncate();
    return {
      note: `${label} clipped at ${max} characters`,
      preview: redactBearerSecrets(serialized.slice(0, max)),
    };
  }
  const redacted = redactBearerSecrets(serialized);
  try {
    return JSON.parse(redacted) as Record<string, unknown>;
  } catch {
    // Redaction can only shorten values, but never trade a stored trace for a
    // failed turn: fall back to the unredacted object's own strings.
    return value;
  }
}
