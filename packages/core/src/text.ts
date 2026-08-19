/**
 * The shared text primitives the deterministic engines compare messages with:
 * one normaliser, one stopword list, one stemmer.
 *
 * They started inside the keyword router and moved out when the courtesy
 * detector (#566) needed the *same* treatment - "do not add a second
 * normaliser" is only enforceable if there is one place to import it from.
 * Nothing here knows about Flows; it is string handling, no domain logic.
 */

/**
 * Words carrying no routing signal, in the two languages the deterministic
 * engines ship with. Note what this list is NOT: a linguistic stopword list. It
 * exists so a message's *remaining* tokens are the ones worth comparing, which
 * is why it also holds flow-description filler ("user", "asking", "explicitly").
 */
export const STOPWORDS = new Set([
  // en
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "do",
  "does", "did", "can", "could", "will", "would", "should", "may", "might",
  "i", "me", "my", "you", "your", "we", "our", "it", "its", "this", "that",
  "to", "of", "in", "on", "for", "with", "about", "and", "or", "not", "no",
  "how", "what", "when", "where", "who", "which", "why", "there", "please",
  "user", "users", "asking", "asks", "ask", "wants", "want", "explicitly",
  "otherwise", "them", "they", "their",
  // it
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "da", "che",
  "chi", "come", "cosa", "quando", "dove", "perche", "per", "con", "su",
  "sono", "sei", "ho", "hai", "ha", "posso", "puoi", "vorrei", "voglio",
  "mi", "ti", "si", "e", "o", "non", "del", "della", "dei", "delle", "al",
  "alla", "ai", "alle", "quale", "quali", "questo", "questa", "fare",
]);

/** Lowercase, strip accents, strip punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude stemmer: compare tokens by their first 6 characters. */
export function stem(token: string): string {
  return token.slice(0, 6);
}

/**
 * EVERY word in the normalized message, stopwords and single letters included.
 * Use this when the absence of a word matters (the courtesy detector has to see
 * leftovers it cannot account for); use {@link tokenize} when comparing meaning.
 */
export function allWords(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

/** Only the words worth comparing: stopwords and single letters dropped. */
export function tokenize(text: string): string[] {
  return allWords(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}
