import { AsyncLocalStorage } from "node:async_hooks";
import type { LanguageModelMiddleware } from "ai";
import type {
  LanguageModelV4Content,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import {
  maskingGuardrail,
  messageText,
  transcriptPiiMasker,
  type AssistantGuardrail,
  type ChatAttachment,
  type MaskingGuardrail,
  type PiiDetector,
  type PiiMasker,
  type PiiMaskerOptions,
  type PiiMaskingTrace,
  type PiiOrigin,
  type PlaceholderRestorer,
  type StoredMessage,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/**
 * The runtime half of the PII masking Guardrail (#1078; the detectors and the
 * placeholder map are core's `pii.ts`).
 *
 * The guarantee is about every model call a Conversation Turn makes, and a
 * turn makes them from a dozen places: Intent Classification, the pre-flight,
 * the agent loop, follow-ups, the topic check, the query embedding. Threading
 * a masker through each would hold only until somebody added a thirteenth. So
 * the turn makes its masker *active* for everything it runs (an
 * AsyncLocalStorage scope, `withPiiMasking`), and the masking happens where
 * every model call already passes:
 *
 * - `buildModel` puts {@link piiMaskingMiddleware} on every language model: it
 *   masks the whole prompt on the way out and restores every placeholder on
 *   the way back, text, reasoning and tool-call arguments alike, so the turn,
 *   its tools, the wire and the saved message only ever see real values.
 * - The calls that are not language models ask {@link maskOutbound} for their
 *   text: `decide()` (Jev is an evaluation model), embeddings, rerank and the
 *   moderation request.
 *
 * Outside an active scope every function here is the identity, which is the
 * state of every Teammate turn, every job and every Assistant with masking off.
 * Work a turn schedules for after its response leaves the scope
 * (`registerRuntimeHost` wraps the port): it belongs to no turn, and a host's
 * `after()` would otherwise carry this turn's masker into it.
 */

/**
 * On `globalThis` for the reason `host.ts` gives: a host may compile this
 * package into several graphs in one process, and the turn that opens the
 * scope and the model that reads it must share one store.
 */
const SCOPE_SLOT = Symbol.for("@agent-hub/agent:pii-masking-scope");
const scopes = globalThis as { [SCOPE_SLOT]?: AsyncLocalStorage<PiiMasker> };
const active: AsyncLocalStorage<PiiMasker> = (scopes[SCOPE_SLOT] ??= new AsyncLocalStorage<PiiMasker>());

/** Runs `run` with `masker` active for every model call it makes. */
export function withPiiMasking<T>(masker: PiiMasker | null, run: () => T): T {
  return masker ? active.run(masker, run) : run();
}

/** Runs `run` with no masker active, whatever scope it was called from. */
export function outsidePiiMasking<T>(run: () => T): T {
  return active.exit(run);
}

/** `text` as a model provider may see it, under the active masker. */
export function maskOutbound(text: string, origin?: PiiOrigin): string {
  const masker = active.getStore();
  return masker ? masker.mask(text, origin) : text;
}

/** Every string in a JSON-shaped value masked; keys and other values kept. */
export function maskOutboundValue<T>(value: T): T {
  const masker = active.getStore();
  return masker ? mapStrings(value, (text) => masker.mask(text)) : value;
}

/**
 * Says where the values in `value` came from, before any model sees them
 * (#1079): a retrieved passage is `knowledge`, a tool's result is `tool`.
 * Seeding numbers a value and records its origin; it counts as masked only
 * once a request carries it.
 */
export function seedOutbound(value: unknown, origin: PiiOrigin): void {
  const masker = active.getStore();
  if (masker) eachString(value, (text) => masker.seed(text, origin));
}

function eachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) eachString(item, visit);
  else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) eachString(item, visit);
  }
}

/** A turn's masking: the guardrail that asked for it and the masker doing it. */
export interface TurnPiiMasking {
  guardrail: MaskingGuardrail;
  masker: PiiMasker;
}

/**
 * The masking for an Assistant turn, or null when its PII masking guardrail is
 * off. Every literal the Visitor typed that looks like a placeholder is
 * reserved first, then the Conversation is seeded in order, then the new
 * message and the text of any file sent with it, so the Visitor's values get
 * the first placeholders and the numbering is the same function of the
 * transcript every time it is rebuilt.
 */
export function turnPiiMasking(
  guardrails: readonly AssistantGuardrail[] | undefined,
  history: readonly Pick<StoredMessage, "role" | "content">[],
  message: string,
  attachments: readonly ChatAttachment[] = []
): TurnPiiMasking | null {
  const guardrail = maskingGuardrail(guardrails);
  if (!guardrail) return null;
  // The new message and its files are the Visitor's, like their history.
  const masker = transcriptPiiMasker(guardrail.detectors, [
    ...transcriptOf(history),
    { role: "user" as const, text: message },
    ...attachments.map((attachment) => ({ role: "user" as const, text: attachment.text })),
  ]);
  return { guardrail, masker };
}

function transcriptOf(messages: readonly Pick<StoredMessage, "role" | "content">[]) {
  return messages.map((stored) => ({ role: stored.role, text: messageText(stored.content) }));
}

/**
 * What an Assistant's Conversations are masked with after a turn (#1080), or
 * null when neither its live config nor its current Publication has PII
 * masking on. Both, because a widget turn ran on the Publication and a
 * Preview turn on the live config, and a job cannot tell which a
 * Conversation saw; where both mask, the job masks everything either would.
 * A read that fails throws: "could not tell" must never read as "off".
 */
async function assistantMaskingDetectors(
  db: Db,
  assistantId: string | null | undefined
): Promise<PiiDetector[] | null> {
  if (!assistantId) return null;
  const [assistant, publication] = await Promise.all([
    db.getAssistant(assistantId),
    db.getLatestPublication(assistantId),
  ]);
  const detectors = [
    ...(maskingGuardrail(assistant?.guardrails)?.detectors ?? []),
    ...(maskingGuardrail(publication?.config.assistant.guardrails)?.detectors ?? []),
  ];
  return detectors.length > 0 ? [...new Set(detectors)] : null;
}

/**
 * The masker for work that runs after a turn and outside it (#1080): the
 * Answer Verdict, Suggested Fix drafting, Compost, memory promotion, feedback
 * triage. The turn never stored its placeholder map, so this rebuilds one from
 * the transcript with the same deterministic seeding (`transcriptPiiMasker`),
 * and loads that transcript only when masking is on. Null leaves the job
 * exactly as it was. Throws when the guardrail cannot be read, so a job that
 * cannot tell whether to mask makes no model call at all.
 */
export async function postTurnPiiMasker(
  db: Db,
  assistantId: string | null | undefined,
  loadTranscript: () => Promise<readonly Pick<StoredMessage, "role" | "content">[]>,
  options: PiiMaskerOptions = {}
): Promise<PiiMasker | null> {
  const detectors = await assistantMaskingDetectors(db, assistantId);
  if (!detectors) return null;
  return transcriptPiiMasker(detectors, transcriptOf(await loadTranscript()), options);
}

/** {@link postTurnPiiMasker} and the scope in one: `run`'s model calls are masked. */
export async function withPostTurnMasking<T>(
  db: Db,
  assistantId: string | null | undefined,
  loadTranscript: () => Promise<readonly Pick<StoredMessage, "role" | "content">[]>,
  run: () => Promise<T>,
  options: PiiMaskerOptions = {}
): Promise<T> {
  return withPiiMasking(await postTurnPiiMasker(db, assistantId, loadTranscript, options), run);
}

/** The trace entry for what the turn sent masked, or undefined when nothing. */
export function piiMaskingTrace(masking: TurnPiiMasking | null): PiiMaskingTrace | undefined {
  const masked = masking?.masker.report() ?? [];
  return masking && masked.length > 0
    ? { id: masking.guardrail.id, name: masking.guardrail.name, masked }
    : undefined;
}

function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, mapStrings(item, map)])
    ) as T;
  }
  return value;
}

/**
 * The middleware `buildModel` puts on every language model. It reads the
 * active masker once per call, so a model built before a turn, or shared
 * between two, masks with whichever turn is calling it.
 */
export function piiMaskingMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      const masker = active.getStore();
      return masker ? { ...params, prompt: maskPrompt(params.prompt, masker) } : params;
    },
    async wrapGenerate({ doGenerate }) {
      const masker = active.getStore();
      const result = await doGenerate();
      return masker ? { ...result, content: result.content.map((part) => restoreContent(part, masker)) } : result;
    },
    async wrapStream({ doStream }) {
      const masker = active.getStore();
      const result = await doStream();
      return masker ? { ...result, stream: result.stream.pipeThrough(restoringStream(masker)) } : result;
    },
  };
}

/**
 * Every text a provider would read: the system prompt, every message's text
 * and reasoning, tool-call arguments and tool results. Files pass as they are.
 */
export function maskPrompt(prompt: LanguageModelV4Prompt, masker: PiiMasker): LanguageModelV4Prompt {
  const mask = (text: string) => masker.mask(text);
  return prompt.map((message): LanguageModelV4Message => {
    switch (message.role) {
      case "system":
        return { ...message, content: mask(message.content) };
      case "user":
        return {
          ...message,
          content: message.content.map((part) => (part.type === "text" ? { ...part, text: mask(part.text) } : part)),
        };
      case "assistant":
        return {
          ...message,
          content: message.content.map((part) => {
            switch (part.type) {
              case "text":
              case "reasoning":
                return { ...part, text: mask(part.text) };
              case "tool-call":
                return { ...part, input: mapStrings(part.input, mask) };
              case "tool-result":
                return { ...part, output: maskToolOutput(part.output, mask) };
              default:
                return part;
            }
          }),
        };
      case "tool":
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-result" ? { ...part, output: maskToolOutput(part.output, mask) } : part
          ),
        };
    }
  });
}

function maskToolOutput(
  output: LanguageModelV4ToolResultOutput,
  mask: (text: string) => string
): LanguageModelV4ToolResultOutput {
  switch (output.type) {
    case "text":
    case "error-text":
      return { ...output, value: mask(output.value) };
    case "json":
    case "error-json":
      return { ...output, value: mapStrings(output.value, mask) };
    case "execution-denied":
      return output.reason ? { ...output, reason: mask(output.reason) } : output;
    case "content":
      return {
        ...output,
        value: output.value.map((item) => (item.type === "text" ? { ...item, text: mask(item.text) } : item)),
      };
    default:
      return output;
  }
}

/**
 * A tool call's arguments are a JSON string. Restored value by value through
 * a parse, so a restored value can never break the JSON around it; text that
 * does not parse is restored as text, and the tool's own validation rejects it
 * exactly as it would have rejected the masked form.
 */
function restoreToolInput(input: string, masker: PiiMasker): string {
  // Untouched unless a placeholder it issued is in there: a reserialised
  // argument string is equal JSON, but no reason to change one.
  if (masker.restore(input) === input) return input;
  try {
    return JSON.stringify(mapStrings(JSON.parse(input) as unknown, (text) => masker.restore(text)));
  } catch {
    return masker.restore(input);
  }
}

function restoreContent(part: LanguageModelV4Content, masker: PiiMasker): LanguageModelV4Content {
  switch (part.type) {
    case "text":
    case "reasoning":
      return { ...part, text: masker.restore(part.text) };
    case "tool-call":
      return { ...part, input: restoreToolInput(part.input, masker) };
    default:
      return part;
  }
}

/**
 * The streaming restore. Each text, reasoning and tool-input segment gets its
 * own restorer, keyed by the segment id, so a placeholder split across two
 * deltas is held back until it is whole and released when its segment ends.
 * The finished tool call carries the whole argument string, which is what the
 * SDK executes, and is restored in one piece.
 */
function restoringStream(
  masker: PiiMasker
): TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart> {
  const open = new Map<string, { restorer: PlaceholderRestorer; type: "text-delta" | "reasoning-delta" | "tool-input-delta" }>();
  const deltaOf = (type: "text-delta" | "reasoning-delta" | "tool-input-delta", id: string, delta: string) =>
    ({ type, id, delta }) as LanguageModelV4StreamPart;
  const flush = (id: string, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
    const segment = open.get(id);
    if (!segment) return;
    open.delete(id);
    const rest = segment.restorer.end();
    if (rest) controller.enqueue(deltaOf(segment.type, id, rest));
  };
  return new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "text-delta":
        case "reasoning-delta":
        case "tool-input-delta": {
          const segment = open.get(chunk.id) ?? { restorer: masker.restorer(), type: chunk.type };
          open.set(chunk.id, segment);
          const shown = segment.restorer.push(chunk.delta);
          if (shown) controller.enqueue({ ...chunk, delta: shown });
          return;
        }
        case "text-end":
        case "reasoning-end":
        case "tool-input-end":
          flush(chunk.id, controller);
          controller.enqueue(chunk);
          return;
        case "tool-call":
          controller.enqueue({ ...chunk, input: restoreToolInput(chunk.input, masker) });
          return;
        case "finish":
          for (const id of [...open.keys()]) flush(id, controller);
          controller.enqueue(chunk);
          return;
        default:
          controller.enqueue(chunk);
      }
    },
    flush(controller) {
      for (const id of [...open.keys()]) flush(id, controller);
    },
  });
}
