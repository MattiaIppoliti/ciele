import type { Provider } from "./types";

/**
 * One chat model, named the way an allow-list names it: the provider that
 * serves it and the id that provider knows it by. The same pair the Assistant
 * and the Teammate already store as two scalar fields, given a name so a list
 * of them can be written down.
 */
export interface ModelRef {
  provider: Provider;
  modelId: string;
  /**
   * Which credential serves it. Absent means automatic: the runtime takes the
   * first source that has a credential, the order it always used. Present, the
   * turn runs on exactly that source, so the same model can be offered twice,
   * once on the Organization's API key and once through AI Gateway.
   */
  source?: ModelSource;
}

/**
 * Where a stored model choice's credential comes from: the platform plan, the
 * Organization's own API key, its keyless enterprise auth, AI Gateway on the
 * Organization's own Gateway key (`ai_gateway`, the Organization pays), or AI
 * Gateway on the platform's key (`platform_gateway`, the plan pays). A Member's personal
 * subscription is deliberately not one: it is set once in Settings and never
 * stored on an Assistant or a Teammate (ADR-0007 as amended by #769).
 */
export const MODEL_SOURCES = [
  "platform",
  "api_key",
  "federated",
  "ai_gateway",
  "platform_gateway",
] as const;

export type ModelSource = (typeof MODEL_SOURCES)[number];

export function isModelSource(value: unknown): value is ModelSource {
  return (MODEL_SOURCES as readonly unknown[]).includes(value);
}

/**
 * Two refs name the same choice: provider, id and source. Ids are
 * case-sensitive; an automatic ref and a pinned one are different choices.
 */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return (
    a.provider === b.provider &&
    a.modelId === b.modelId &&
    (a.source ?? null) === (b.source ?? null)
  );
}

/**
 * The models an asker may choose between, configured one first.
 *
 * An empty allow-list is the default and means **no choice**: the caller gets
 * the one configured model back, and a composer that is handed a single option
 * renders no picker. That is what keeps every Assistant published before this
 * feature existed behaving exactly as it did, rather than silently opening its
 * organization's whole catalogue to anonymous Visitors.
 *
 * The configured model is always first and always present, even when an admin
 * left it out of the allow-list: it is what the turn runs absent a choice, so a
 * list that omits it would describe a state the runtime cannot be in.
 */
export function modelChoices(
  configured: ModelRef,
  allowed: readonly ModelRef[]
): ModelRef[] {
  if (allowed.length === 0) return [configured];
  const rest = allowed.filter((ref) => !sameModel(ref, configured));
  // First occurrence wins, so an admin's ordering survives.
  const unique = rest.filter(
    (ref, i) => rest.findIndex((other) => sameModel(other, ref)) === i
  );
  return [configured, ...unique];
}

/**
 * What model this turn runs, given what the client asked for.
 *
 * **Never throws and never refuses.** A request naming a model that is not on
 * the list falls back to the configured one and answers, because the client
 * that sent it is a widget on someone else's page which may be running a
 * Publication older than the one serving it: a stale choice must cost the
 * Visitor nothing. The allow-list is still authoritative, the client's string
 * only ever selects from it and can never introduce a model of its own.
 */
export function resolveRequestedModel(
  requested: ModelRef | null | undefined,
  configured: ModelRef,
  allowed: readonly ModelRef[]
): ModelRef {
  if (!requested) return configured;
  const choices = modelChoices(configured, allowed);
  return choices.find((ref) => sameModel(ref, requested)) ?? configured;
}

/**
 * Parses the one string a client sends, `"<provider>:<model id>"`.
 *
 * Shape only: whether the provider is a real one and whether the model exists
 * is {@link resolveRequestedModel}'s business, against the allow-list. Model
 * ids carry no colon today, but the split is bounded at the first one so one
 * that does survives the round trip.
 */
export function parseModelSelector(
  selector: string | null | undefined
): ModelRef | null {
  if (typeof selector !== "string") return null;
  const separator = selector.indexOf(":");
  if (separator <= 0) return null;
  const provider = selector.slice(0, separator);
  let modelId = selector.slice(separator + 1).trim();
  // A trailing `#<source>` pins the source. Only a source this build knows
  // counts as one; anything else stays part of the id, which the allow-list
  // then fails to match, exactly as an unknown model would.
  const hash = modelId.lastIndexOf("#");
  const source = hash > 0 ? modelId.slice(hash + 1) : null;
  if (isModelSource(source)) {
    modelId = modelId.slice(0, hash).trim();
    if (!modelId) return null;
    return { provider: provider as Provider, modelId, source };
  }
  if (!modelId) return null;
  return { provider: provider as Provider, modelId };
}

/**
 * The inverse of {@link parseModelSelector}. Takes any provider string, so an
 * Eval candidate (a Voyage reranker, Jev) keys the same way as a chat model.
 */
export function modelSelector(ref: {
  provider: string;
  modelId: string;
  source?: ModelSource;
}): string {
  const base = `${ref.provider}:${ref.modelId}`;
  return ref.source ? `${base}#${ref.source}` : base;
}
