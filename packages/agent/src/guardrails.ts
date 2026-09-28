import type { ProviderConnection } from "@agent-hub/core";
import {
  GUARDRAIL_TOPIC_CAP,
  createMarkerSuppressor,
  deterministicViolation,
  inputGuardrails,
  suppressMarkedContent,
  type AssistantGuardrail,
  type MarkerSuppressor,
  type StreamGuardrail,
  type GuardrailTraceEntry,
  type InputGuardrail,
} from "@agent-hub/core";
import { decide, type ResolvedDecisionModel } from "./decision-model";
import { resolveProviderCredential, type KeyResolution } from "./models";
import { raceTimeout } from "./preflight-shadow";
import type { ChatReplyPart, RuntimeEvent, UsageEvent } from "./types";

/**
 * The input half of Guardrails (packages/core/src/guardrails.ts). Runs the
 * Assistant's enabled input checks in the admin's order before any Flow sees
 * the message, and stops at the first that blocks.
 *
 * The two deterministic checks are core's. The two model-backed ones live
 * here because they call out: `moderation` posts to OpenAI's moderation
 * endpoint on the Organization's OpenAI connection, and `restrict_to_topic` is
 * one decision on the decision model the pre-flight already uses. Each
 * model-backed check has a budget, and what a failure means is the
 * guardrail's own `onError`, because "the Assistant stays up" and "the
 * guarantee holds" are both legitimate policies and only the admin knows
 * which this one is.
 */

/** Per-check budget for a model-backed guardrail. */
export const GUARDRAIL_CHECK_TIMEOUT_MS = 3_000;
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";

export type GuardrailCheck = GuardrailTraceEntry;

export interface InputGuardrailResult {
  /** The guardrail that blocked, or null. */
  blocked: InputGuardrail | null;
  checks: GuardrailCheck[];
}

export interface InputGuardrailDeps {
  connections: ProviderConnection[];
  keyResolution?: KeyResolution;
  /** The topic check's model, null when nothing can evaluate. */
  decisionModel: ResolvedDecisionModel | null;
  signal?: AbortSignal;
  recordUsage?: (usage: UsageEvent) => void;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function runInputGuardrails(
  guardrails: readonly AssistantGuardrail[] | undefined,
  message: string,
  deps: InputGuardrailDeps
): Promise<InputGuardrailResult> {
  const checks: GuardrailCheck[] = [];
  for (const guardrail of inputGuardrails(guardrails)) {
    const ran = await runOne(guardrail, message, deps);
    const check: GuardrailCheck =
      ran.outcome === "blocked" && guardrail.action === "log" ? { ...ran, outcome: "logged" } : ran;
    checks.push(check);
    if (check.outcome === "blocked") return { blocked: guardrail, checks };
  }
  return { blocked: null, checks };
}

async function runOne(
  guardrail: InputGuardrail,
  message: string,
  deps: InputGuardrailDeps
): Promise<GuardrailCheck> {
  const base = { id: guardrail.id, type: guardrail.type, name: guardrail.name };
  const deterministic = deterministicViolation(guardrail, message);
  if (deterministic !== null) return { ...base, outcome: deterministic ? "blocked" : "pass" };

  if (guardrail.type !== "moderation" && guardrail.type !== "restrict_to_topic") {
    return { ...base, outcome: "pass" };
  }
  const work =
    guardrail.type === "moderation"
      ? (signal: AbortSignal) => moderationBlocks(guardrail, message, deps, signal)
      : (signal: AbortSignal) => topicBlocks(guardrail, message, deps, signal);
  const outcome = await raceTimeout(work, {
    signal: deps.signal,
    timeoutMs: deps.timeoutMs ?? GUARDRAIL_CHECK_TIMEOUT_MS,
  });
  const failed = (detail: string): GuardrailCheck => ({
    ...base,
    // `block` on failure is a block, and the trace says why.
    outcome: guardrail.onError === "block" ? "blocked" : "unavailable",
    detail,
  });
  if (outcome.kind === "timeout") return failed("Timed out");
  if (outcome.kind === "error") return failed(errorText(outcome.error));
  const verdict = outcome.value;
  if (verdict.kind === "unavailable") return failed(verdict.detail);
  return verdict.blocks
    ? { ...base, outcome: "blocked", ...(verdict.detail ? { detail: verdict.detail } : {}) }
    : { ...base, outcome: "pass" };
}

type Verdict = { kind: "ok"; blocks: boolean; detail?: string } | { kind: "unavailable"; detail: string };

async function moderationBlocks(
  guardrail: Extract<InputGuardrail, { type: "moderation" }>,
  message: string,
  deps: InputGuardrailDeps,
  signal: AbortSignal
): Promise<Verdict> {
  const credential = resolveProviderCredential("openai", deps.connections, deps.keyResolution ?? {});
  const apiKey = credential && "apiKey" in credential ? credential.apiKey : null;
  if (!apiKey) return { kind: "unavailable", detail: "No OpenAI connection" };

  const response = await (deps.fetch ?? fetch)(OPENAI_MODERATION_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: guardrail.model, input: message }),
    signal,
  });
  if (!response.ok) return { kind: "unavailable", detail: `Moderation returned ${response.status}` };
  const body = (await response.json()) as {
    results?: { flagged?: boolean; categories?: Record<string, boolean> }[];
  };
  const result = body.results?.[0];
  if (!result) return { kind: "unavailable", detail: "Moderation returned no result" };
  const flagged = Object.entries(result.categories ?? {})
    .filter(([, on]) => on)
    .map(([category]) => category);
  // No selection: the model's own `flagged` decides. A selection: only those.
  const blocks =
    guardrail.categories.length === 0
      ? result.flagged === true
      : flagged.some((category) => guardrail.categories.includes(category));
  return blocks
    ? { kind: "ok", blocks: true, detail: flagged.join(", ") || "flagged" }
    : { kind: "ok", blocks: false };
}

const OFF_TOPIC = "other";

async function topicBlocks(
  guardrail: Extract<InputGuardrail, { type: "restrict_to_topic" }>,
  message: string,
  deps: InputGuardrailDeps,
  signal: AbortSignal
): Promise<Verdict> {
  if (!deps.decisionModel) return { kind: "unavailable", detail: "No model can check the topic" };
  const topics = guardrail.topics.map((t) => t.trim()).filter(Boolean).slice(0, GUARDRAIL_TOPIC_CAP);
  const criteria: Record<string, string> = {};
  topics.forEach((topic, i) => (criteria[`topic_${i}`] = `The message is mainly about: ${topic}`));
  criteria[OFF_TOPIC] =
    "The message is mainly about something else. A greeting or a thank-you counts as the closest listed topic, not as this.";
  const decision = await decide(deps.decisionModel, {
    // The message is the state; the topics are the organization's own words.
    state: message,
    questions: {
      topic: {
        type: "choice",
        instructions: "What is the main topic of the visitor's message? Judge the whole message, not a single word.",
        criteria,
      },
    },
    abortSignal: signal,
  });
  deps.recordUsage?.(decision.usage);
  const choice = decision.answers.topic.choice;
  return choice === OFF_TOPIC
    ? { kind: "ok", blocks: true, detail: "Off topic" }
    : { kind: "ok", blocks: false };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Text an admin wrote word for word: a verbatim Message and a guardrail's own
 * reply. Output rules exist for what a model writes, so these pass untouched.
 */
function suppressesAction(action: string): boolean {
  return action !== "custom_message" && action !== "guardrail";
}

/**
 * The `sensitive_content_stream` half on the wire: every streamed text segment
 * runs through its own suppressor, reset on `text-start` and drained before
 * `text-end`, so a marker split across deltas is still caught and the tail
 * held back for it is released when the segment ends. A whole text part gets
 * the same function in one call.
 */
export function suppressingEmit(
  emit: (event: RuntimeEvent) => void,
  rules: readonly StreamGuardrail[]
): (event: RuntimeEvent) => void {
  if (rules.length === 0) return emit;
  let suppressor: MarkerSuppressor | null = null;
  return (event) => {
    if (event.type === "text-start") {
      suppressor = createMarkerSuppressor(rules);
      emit(event);
    } else if (event.type === "text-delta") {
      suppressor ??= createMarkerSuppressor(rules);
      const shown = suppressor.push(event.delta);
      if (shown) emit({ ...event, delta: shown });
    } else if (event.type === "text-end") {
      const rest = suppressor?.end() ?? "";
      suppressor = null;
      if (rest) emit({ type: "text-delta", delta: rest });
      emit(event);
    } else if (event.type === "part") {
      emit({ ...event, part: suppressPart(event.part, rules) });
    } else {
      emit(event);
    }
  };
}

/** What is persisted, through the same rules, so the Inbox shows what was seen. */
export function suppressPart(part: ChatReplyPart, rules: readonly StreamGuardrail[]): ChatReplyPart {
  return part.type === "text" && suppressesAction(part.action)
    ? { ...part, text: suppressMarkedContent(part.text, rules) }
    : part;
}
