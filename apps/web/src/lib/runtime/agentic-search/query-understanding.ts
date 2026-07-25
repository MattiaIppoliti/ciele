import type { HistoryMessage } from "../types";

/**
 * Agentic Search discipline — slice 2: query understanding + the context frame
 * (issue #154, spec #61). Pure, model-free scaffolding the `search_knowledge`
 * generative loop consults BEFORE its first search. Everything here is
 * deterministic and unit-tested directly (no model call); the LLM loop stays
 * the generative core (runtime invariant: generation lives inside
 * `search_knowledge`). Query understanding runs AFTER Flow classification —
 * `classifyIntent` still picks the Flow; this only shapes retrieval within
 * `search_knowledge`.
 *
 * Two things and no more this slice:
 *  1. a context frame assembled from signals confirmed live at runtime (the
 *     active Knowledge Collection via `collectionId`, conversation history, and
 *     session memory — see docs/audits/agentic-search-context-signals.md);
 *  2. a reference resolver that turns a deictic / underspecified follow-up
 *     ("what about the second one?", "the third concept") into a concrete first
 *     search query, using the history in the frame.
 *
 * Reformulation / scope-widening is deliberately NOT here — that is slice #155.
 * The clarify part is slice #156.
 */

/**
 * The live context available to a turn's retrieval, per the #53 audit. Only
 * these three signals actually reach `search_knowledge` today; role / URL / SSO
 * are inert and intentionally excluded.
 */
export interface ContextFrame {
  /** Active Knowledge Collection anchor, or null when the turn is assistant-wide. */
  collectionId: string | null;
  /** Recent transcript of THIS conversation (already capped upstream). */
  history: readonly HistoryMessage[];
  /** Facts the `remember` tool saved earlier in this conversation. */
  memory: readonly string[];
}

/** The structured search intent understanding derives from a raw message. */
export interface SearchIntent {
  /**
   * The first `searchKnowledge` query. Equals the raw message when nothing
   * needed resolving; a concrete subject pulled from history when the message
   * referred back to the conversation.
   */
  query: string;
  /**
   * True when the message referred back to earlier context (a deictic /
   * anaphoric reference) AND history let us resolve it — the signal the handler
   * uses to seed the loop's first search with {@link query}. False when the
   * message stands alone, or when a reference could not be resolved (no
   * antecedent in history) and we degrade to searching the raw message.
   */
  resolvedFromReference: boolean;
  /** The subject pulled from history to resolve a reference (observability). */
  referent?: string;
  /**
   * Soft, history-derived guess at what the visitor is struggling with. Set
   * only when a confusion cue appears in the message or recent history;
   * omitted entirely when history gives no signal.
   */
  confusedAbout?: string;
  /**
   * True when the message is a deictic follow-up ("what about the second
   * one?") that history could NOT resolve AND carries no standalone topic of
   * its own — i.e. there is nothing usable to search. The pre-search signal
   * the clarify decision (#156) consults: searching the raw pronoun would only
   * dead-end, so the turn asks a focused question instead of guessing.
   */
  unresolved: boolean;
}

/** Assembles the {@link ContextFrame} from the three live signals. */
export function buildContextFrame(input: {
  collectionId?: string | null;
  history?: readonly HistoryMessage[];
  memory?: readonly string[];
}): ContextFrame {
  return {
    collectionId: input.collectionId ?? null,
    history: input.history ?? [],
    memory: (input.memory ?? []).filter((m) => m.trim()),
  };
}

// ── Lexical primitives (all case-insensitive, deterministic) ─────────────────

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/**
 * Generic head nouns a deictic reference hangs on ("the third CONCEPT", "the
 * second ONE"). A real proper noun after an ordinal ("First World War") is not
 * in this set, so it is not treated as a reference.
 */
const GENERIC_NOUNS = new Set([
  "one", "ones", "concept", "concepts", "item", "items", "step", "steps",
  "point", "points", "question", "questions", "part", "parts", "section",
  "sections", "option", "options", "thing", "things", "topic", "topics",
  "chapter", "chapters", "unit", "units", "example", "examples", "answer",
  "answers", "reason", "reasons", "cause", "causes", "factor", "factors",
  "idea", "ideas", "term", "terms", "point.",
]);

const ANAPHOR_WORDS = new Set([
  "it", "that", "this", "those", "these", "them", "one", "ones", "same",
]);

/** Words that carry no topic signal — stripped when extracting a topic phrase. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "was", "were", "be", "do", "does", "did", "can", "could", "would", "should",
  "what", "why", "how", "when", "where", "who", "which", "about", "tell", "me",
  "explain", "please", "i", "im", "i'm", "you", "we", "my", "your", "with",
  "into", "some", "more", "again", "so", "just", "really", "dont", "don't",
  "get", "got", "understand", "understanding", "follow", "know", "mean",
  "means", "vs", "confused", "confusing", "lost", "struggling", "struggle",
  "sure", "cant", "can't", "cannot",
]);

const CONFUSION_CUES: RegExp[] = [
  /\b(?:do ?n['’]?t|cannot|can['’]?t|couldn['’]?t)\s+(?:really\s+)?(?:understand|get|follow|figure|grasp)\b/i,
  /\bconfus(?:ed|ing)\b/i,
  /\bunclear\b/i,
  /\bmakes?\s+no\s+sense\b/i,
  /\bstruggl(?:e|ing)\b/i,
  /\b(?:i['’]?m|feeling)\s+lost\b/i,
  /\bhard\s+to\s+(?:understand|follow|grasp)\b/i,
  /\bnot\s+sure\s+(?:i\s+)?(?:understand|get)\b/i,
];

function hasConfusionCue(text: string): boolean {
  return CONFUSION_CUES.some((re) => re.test(text));
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Reduces a message to its salient topic words (drops question words +
 * stopwords), preserving order and the original casing of kept words. Returns
 * "" when nothing salient remains.
 */
function topicPhrase(text: string, cap = 120): string {
  const kept: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const bare = raw.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!bare) continue;
    const lower = bare.toLowerCase();
    if (STOPWORDS.has(lower) || ANAPHOR_WORDS.has(lower)) continue;
    if (lower in ORDINAL_WORDS) continue;
    kept.push(bare);
  }
  return kept.join(" ").slice(0, cap).trim();
}

interface Reference {
  kind: "ordinal" | "anaphor" | "none";
  ordinal?: number;
  /** The generic head noun ("concept"), when the reference named one. */
  generic?: string;
}

/**
 * Detects whether a message refers back to earlier context rather than standing
 * on its own. An ordinal must be followed by a generic head noun (or stand
 * alone at the end) to count — so proper nouns like "First World War" do not
 * trigger. A bare anaphor counts only in a short, low-content message.
 */
function detectReference(message: string): Reference {
  const toks = words(message);
  if (toks.length === 0) return { kind: "none" };

  // Ordinal + generic noun ("the third concept", "the second one"), or an
  // ordinal standing alone near the end ("what about the second?").
  for (let i = 0; i < toks.length; i++) {
    const ord = ORDINAL_WORDS[toks[i]] ?? parseDigitOrdinal(toks[i]);
    if (ord === undefined) continue;
    const next = toks[i + 1];
    if (next && GENERIC_NOUNS.has(next)) {
      return { kind: "ordinal", ordinal: ord, generic: next };
    }
    // "the second" with nothing meaningful after it is still a reference.
    const rest = toks.slice(i + 1).filter((t) => !STOPWORDS.has(t));
    if (rest.length === 0) return { kind: "ordinal", ordinal: ord };
  }

  // Bare anaphor ("what about it?", "tell me more about that") — only when the
  // message has almost no topic of its own to search.
  const anaphor = toks.some((t) => ANAPHOR_WORDS.has(t));
  if (anaphor && topicPhrase(message).length === 0) {
    return { kind: "anaphor" };
  }
  return { kind: "none" };
}

function parseDigitOrdinal(token: string): number | undefined {
  const m = token.match(/^(\d+)(?:st|nd|rd|th)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 50 ? n : undefined;
}

/**
 * Pulls the Nth item out of an enumerated list in assistant text — numbered
 * ("1. …" / "2) …") first, then bullets ("- …" / "• …"). Returns undefined
 * when no such list/item exists.
 */
function nthListItem(text: string, n: number): string | undefined {
  const numbered = new Map<number, string>();
  const numberRe = /(?:^|\n)\s*(\d+)[.)]\s+([^\n]+)/g;
  for (let m = numberRe.exec(text); m; m = numberRe.exec(text)) {
    numbered.set(Number(m[1]), m[2].trim());
  }
  if (numbered.has(n)) return clean(numbered.get(n)!);

  const bullets: string[] = [];
  const bulletRe = /(?:^|\n)\s*[-•*]\s+([^\n]+)/g;
  for (let m = bulletRe.exec(text); m; m = bulletRe.exec(text)) {
    bullets.push(m[1].trim());
  }
  if (n >= 1 && n <= bullets.length) return clean(bullets[n - 1]);
  return undefined;
}

/** Trims a list item to a searchable subject (drops trailing explanation). */
function clean(item: string): string {
  // "Cost-push inflation — when input costs rise" → "Cost-push inflation".
  const head = item.split(/\s+[—–:-]\s+/)[0] ?? item;
  return head.replace(/[.?!]+$/, "").trim().slice(0, 120);
}

/** Most recent history message matching `role`, scanning from the end. */
function lastMessage(
  history: readonly HistoryMessage[],
  role: HistoryMessage["role"]
): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === role && history[i].text.trim()) {
      return history[i].text;
    }
  }
  return undefined;
}

/**
 * The topic the current reference hangs off: the most recent prior user message
 * that itself stands alone (isn't another bare reference), falling back to the
 * most recent assistant message.
 */
function antecedentTopic(history: readonly HistoryMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "user" || !msg.text.trim()) continue;
    if (detectReference(msg.text).kind !== "none") continue;
    const topic = topicPhrase(msg.text);
    if (topic) return topic;
  }
  const assistant = lastMessage(history, "assistant");
  return assistant ? topicPhrase(assistant) : "";
}

/**
 * Derives a structured search intent from the raw message and the context
 * frame. Pure and deterministic — no model call. Resolves a deictic follow-up
 * against `frame.history` into a concrete first search query; leaves a
 * self-contained message untouched.
 */
export function understandQuery(
  message: string,
  frame: ContextFrame
): SearchIntent {
  const raw = message.trim();
  const ref = detectReference(raw);
  const confused =
    hasConfusionCue(raw) ||
    frame.history.some((m) => m.role === "user" && hasConfusionCue(m.text));

  let query = raw;
  let resolvedFromReference = false;
  let referent: string | undefined;

  if (ref.kind !== "none") {
    if (ref.kind === "ordinal" && ref.ordinal !== undefined) {
      const listHit = nthListItem(lastMessage(frame.history, "assistant") ?? "", ref.ordinal);
      const topic = antecedentTopic(frame.history);
      if (listHit) {
        referent = listHit;
        query = listHit;
      } else if (topic) {
        const ordinalWord =
          Object.keys(ORDINAL_WORDS).find((w) => ORDINAL_WORDS[w] === ref.ordinal) ??
          String(ref.ordinal);
        const noun = ref.generic && !ANAPHOR_WORDS.has(ref.generic) ? ` ${ref.generic}` : "";
        referent = topic;
        query = `${ordinalWord}${noun} ${topic}`.trim();
      }
    } else {
      // Anaphor: resolve to the antecedent topic.
      const topic = antecedentTopic(frame.history);
      if (topic) {
        referent = topic;
        query = topic;
      }
    }
    resolvedFromReference = referent !== undefined;
  }

  // A reference we detected but could not resolve, on a message that has no
  // salient topic of its own, is unsearchable — the clarify signal (#156).
  const unresolved =
    ref.kind !== "none" && !resolvedFromReference && topicPhrase(raw).length === 0;

  const intent: SearchIntent = {
    query: query.slice(0, 200).trim() || raw,
    resolvedFromReference,
    unresolved,
  };
  if (referent) intent.referent = referent;
  if (confused) {
    const about = referent || topicPhrase(raw) || antecedentTopic(frame.history);
    if (about) intent.confusedAbout = about;
  }
  return intent;
}

/**
 * Renders the context frame + resolved intent as a system-prompt block, so the
 * model searches the right subject in the right scope first. Returns null when
 * no signal is present (nothing to add). The seeded findings themselves are
 * appended by the handler; this covers guidance only.
 */
export function describeSearchIntent(
  intent: SearchIntent,
  frame: ContextFrame
): string | null {
  const lines: string[] = [];
  if (frame.collectionId) {
    lines.push(
      "- The visitor is anchored to a specific Knowledge Collection — search that collection first before widening."
    );
  }
  if (intent.resolvedFromReference && intent.query.trim()) {
    lines.push(
      `- This message refers back to the conversation. Interpret the question as: "${intent.query.trim()}".`
    );
  }
  if (intent.confusedAbout) {
    lines.push(
      `- The visitor seems to be struggling with: ${intent.confusedAbout}. Explain it plainly rather than just restating it.`
    );
  }
  if (lines.length === 0) return null;
  return ["# Retrieval context (this turn)", ...lines].join("\n");
}
