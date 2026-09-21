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
}

/** Two refs name the same model. Ids are case-sensitive; providers are a union. */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.modelId === b.modelId;
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
  return [configured, ...dedupeModels(rest)];
}

/** First occurrence wins, so an admin's ordering survives. */
function dedupeModels(refs: readonly ModelRef[]): ModelRef[] {
  const seen = new Set<string>();
  const out: ModelRef[] = [];
  for (const ref of refs) {
    const key = `${ref.provider}:${ref.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
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
  const modelId = selector.slice(separator + 1).trim();
  if (!modelId) return null;
  return { provider: provider as Provider, modelId };
}

/** The inverse of {@link parseModelSelector}. */
export function modelSelector(ref: ModelRef): string {
  return `${ref.provider}:${ref.modelId}`;
}
