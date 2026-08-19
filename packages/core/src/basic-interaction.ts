import { flowKeywordMatches, messageFlowCandidates } from "./engine";
import type { FlowRoutingContext } from "./flow-conditions";
import { STOPWORDS, allWords, normalize } from "./text";
import type { Flow } from "./types";

/**
 * Basic Interaction, the deterministic half (#566).
 *
 * Not every message is a question. A Visitor who types `ciao` has an intent but
 * no information need, and routing it through Intent Classification and then
 * retrieval buys nothing: it costs a classify call, a gather loop, a write call,
 * several seconds, and a Thinking panel full of machinery that found nothing.
 * This module recognises that case with **no model call at all**, so the whole
 * turn is one generation.
 *
 * The asymmetry of the two failure modes decides the whole design. A **miss**
 * costs one classify call, the Flow is in the classifier's catalogue too, so
 * the message still reaches it, just less cheaply. A **false positive** costs the
 * Visitor their answer. So every rule below fails closed, and `ciao, quando è la
 * scadenza?` is a question with a greeting stuck on the front, not a greeting.
 */

/** Longest message that can still be pure courtesy, in characters. */
const MAX_COURTESY_CHARS = 64;

/** Longest message that can still be pure courtesy, in words. */
const MAX_COURTESY_WORDS = 6;

/**
 * Words that cannot carry an information need on their own, by locale.
 *
 * Kept as data, per locale, because widening it is the whole of #567: adding a
 * language is a list plus a test row, never a change to the rules below. Entries
 * go through the same {@link normalize} as the message, so writing one with its
 * accents ("tschüss", "até") is correct rather than a word that silently never
 * matches.
 *
 * Two entries are deliberately absent everywhere, and adding them would be a
 * regression rather than an improvement:
 *  - **Bare affirmatives** (`si`, `oui`, `ja`, `sim`, `yes`). After the assistant
 *    asks a question, "yes" is the Visitor's *answer*. The last-turn guard below
 *    already refuses those, and putting them here would make that guard the only
 *    thing standing between a Visitor and a dropped reply.
 *  - **Anything that also reads as a topic.** `fine` is courtesy in English and
 *    "the end" in Italian; `right` is agreement and a direction.
 */
const COURTESY_LEXICON: Record<string, string[]> = {
  en: [
    "hi", "hiya", "hello", "hey", "yo", "howdy", "greetings",
    "good", "morning", "afternoon", "evening", "night", "day",
    "thanks", "thank", "thankyou", "thx", "ty", "cheers", "appreciate",
    "appreciated", "grateful", "helpful",
    "bye", "goodbye", "farewell", "later", "soon", "see",
    "ok", "okay", "okey", "alright", "great", "perfect", "excellent",
    "brilliant", "lovely", "awesome", "nice", "cool", "super", "wonderful",
    "understood", "noted", "got", "sorry", "welcome",
    // Filler that only ever pads a courtesy phrase ("thanks so much", "a lot").
    "so", "much", "lot", "very", "many", "again", "everyone", "all",
  ],
  it: [
    "ciao", "salve", "buongiorno", "buonasera", "buonanotte", "buon", "buona",
    "giorno", "giornata", "serata", "pomeriggio", "notte",
    "grazie", "ringrazio", "grato", "gentile", "gentilissimo",
    "arrivederci", "addio", "presto", "risentirci",
    "ok", "perfetto", "ottimo", "bene", "benissimo", "va", "capito", "chiaro",
    "scusa", "scusi", "prego", "figurati",
    // Filler ("grazie mille", "grazie tante", "a presto").
    "mille", "tante", "tanto", "molto", "davvero", "ancora", "tutti", "tutto",
  ],
  es: [
    "hola", "buenos", "buenas", "días", "tardes", "noches", "saludos",
    "gracias", "agradecido", "amable", "encantado",
    "adiós", "chao", "hasta", "luego", "pronto", "mañana",
    "vale", "bien", "perfecto", "genial", "disculpa", "perdón",
    "muchas", "muchos", "mucho", "muy", "tanto",
  ],
  fr: [
    "bonjour", "bonsoir", "salut", "coucou", "matin", "journée", "soirée",
    "merci", "remercie", "aimable", "ravi",
    "revoir", "au", "bientôt", "demain", "bonne", "nuit",
    "parfait", "super", "génial", "désolé", "pardon",
    "beaucoup", "très", "encore",
  ],
  de: [
    "hallo", "moin", "servus", "guten", "gute", "morgen", "tag", "abend",
    "nacht",
    "danke", "dank", "vielen", "herzlichen", "gern", "gerne", "bitte",
    "tschüss", "wiedersehen", "auf", "bald", "bis",
    "perfekt", "prima", "schön", "entschuldigung",
  ],
  nl: [
    "hoi", "hallo", "goedemorgen", "goedemiddag", "goedenavond", "goeiedag",
    "dag",
    "bedankt", "dank", "wel", "je", "graag",
    "doei", "ziens", "tot", "later",
    "prima", "mooi", "fijn", "sorry",
  ],
  pt: [
    "olá", "oi", "bom", "boa", "dia", "tarde", "noite",
    "obrigado", "obrigada", "agradecido", "valeu", "gentileza",
    "até", "logo", "breve", "abraço", "tchau", "adeus",
    "perfeito", "ótimo", "legal", "desculpa",
    "muito", "muita", "bastante",
  ],
};

const COURTESY_WORDS = new Set(
  Object.values(COURTESY_LEXICON).flat().map(normalize)
);

/**
 * One earlier turn, as the detector needs to see it: who spoke and what the text
 * flattened to. Deliberately not the persisted message shape, the detector is
 * pure and must stay usable from anywhere, including a test with two literals.
 */
export interface CourtesyHistoryTurn {
  role: "user" | "assistant";
  text: string;
  /**
   * Set when the caller knows this turn put a question to the Visitor but the
   * text cannot show it. Needed because a clarification is persisted as a
   * `clarify` part with no text part, so it flattens to the empty string, the
   * question mark this rule would otherwise look for is nowhere in the text.
   * Absent means "read the text", which is right for every ordinary turn.
   */
  askedQuestion?: boolean;
}

/**
 * Whether the assistant's own last turn put a question to the Visitor.
 *
 * The rule that keeps `ok` meaning "yes, go ahead" rather than "hello".
 */
function lastAssistantTurnAsked(history: CourtesyHistoryTurn[]): boolean {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn.role !== "assistant") continue;
    return turn.askedQuestion ?? turn.text.trimEnd().endsWith("?");
  }
  return false;
}

/**
 * Whether this message is nothing but conversational courtesy.
 *
 * The rule, in one line: every word must be courtesy or filler, at least one
 * must be courtesy, and nothing about the message or the turn before it may
 * suggest a question.
 *
 * The "at least one courtesy word" clause is load-bearing. Without it, a message
 * consisting only of stopwords, `the`, `is it`, would qualify by having nothing
 * left over, which is exactly the false-positive class this detector exists to
 * avoid.
 */
export function isCourtesyOnly(
  message: string,
  history: CourtesyHistoryTurn[] = []
): boolean {
  // A question mark is the Visitor telling us they asked something. Believe it,
  // whatever the words are.
  if (message.includes("?")) return false;
  if (message.length > MAX_COURTESY_CHARS) return false;

  const tokens = allWords(message);
  if (tokens.length === 0 || tokens.length > MAX_COURTESY_WORDS) return false;

  let courtesy = 0;
  for (const token of tokens) {
    if (COURTESY_WORDS.has(token)) {
      courtesy += 1;
      continue;
    }
    // Single letters and stopwords are filler, not content. Anything else means
    // the Visitor is talking about something.
    if (token.length > 1 && !STOPWORDS.has(token)) return false;
  }
  if (courtesy === 0) return false;

  return !lastAssistantTurnAsked(history);
}

/** What a courtesy routing decision is made against. */
export interface CourtesyRoutingContext extends FlowRoutingContext {
  /** The conversation so far, oldest first. Absent = a fresh conversation. */
  history?: CourtesyHistoryTurn[];
}

/**
 * The Flow a courtesy message should be answered by, or null to route normally.
 *
 * Three conditions, each of which can only ever *prevent* the shortcut:
 *
 *  1. **The Flow exists and is enabled.** Identified **structurally**, built-in,
 *     carrying the `basic_reply` action, never by name, because an admin is free
 *     to rename it and the runtime must not quietly stop working when they do.
 *     Disabling it is therefore the supported way to turn the fast path off.
 *  2. **The message is courtesy.** See {@link isCourtesyOnly}.
 *  3. **Nothing ahead of it claims the message.** Flow priority stays
 *     authoritative: if an admin put their own Flow above Basic Interaction and
 *     the keyword router considers it a match, the turn classifies normally
 *     instead. Their configuration outranks our optimisation.
 *
 * Routing goes through `messageFlowCandidates`, so the objective Flow Conditions
 * (URL, Schedule) gate this funnel exactly as they gate the other two, one
 * implementation of that rule, not three (spec #550).
 */
export function basicInteractionFlow(
  message: string,
  flows: Flow[],
  context: CourtesyRoutingContext = {}
): Flow | null {
  const candidates = messageFlowCandidates(flows, context);
  const index = candidates.findIndex(
    (flow) => flow.builtIn && flow.actions.includes("basic_reply")
  );
  if (index === -1) return null;
  if (!isCourtesyOnly(message, context.history ?? [])) return null;
  const ahead = candidates.slice(0, index);
  if (ahead.some((flow) => flowKeywordMatches(message, flow))) return null;
  return candidates[index];
}
