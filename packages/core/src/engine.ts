import {
  flowConditionsAllowRouting,
  type FlowRoutingContext,
} from "./flow-conditions";
import type { Flow } from "./types";

/**
 * The deterministic keyword router (ADR-0003): the offline/no-model fallback
 * for Intent Classification. Routing only — rendering a matched Flow's
 * actions is owned by the LLM runtime's action handlers (spec #194).
 */

const STOPWORDS = new Set([
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

/** Extra trigger phrases/tokens for the built-in flows. */
const BUILT_IN_TRIGGERS: Record<
  string,
  { phrases: string[]; tokens: string[] }
> = {
  "assistant information": {
    phrases: [
      "who are you",
      "what can you do",
      "what do you do",
      "what are you",
      "your capabilities",
      "what services",
      "how do you work",
      "chi sei",
      "cosa puoi fare",
      "cosa sai fare",
      "come funzioni",
      "a cosa servi",
    ],
    tokens: ["capabilities", "purpose", "yourself", "servi"],
  },
  "human help needed": {
    phrases: [
      "talk to a human",
      "speak to a human",
      "talk to someone",
      "speak with someone",
      "real person",
      "human help",
      "contact support",
      "customer support",
      "help desk",
      "parlare con un umano",
      "parlare con una persona",
      "un operatore",
      "assistenza umana",
      "contattare il supporto",
    ],
    tokens: ["human", "operator", "person", "support", "umano", "operatore", "persona", "supporto"],
  },
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude stemmer: compare tokens by their first 6 characters. */
function stem(token: string): string {
  return token.slice(0, 6);
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreFlow(message: string, messageStems: Set<string>, flow: Flow): number {
  let score = 0;

  const nameStems = new Set(tokenize(flow.name).map(stem));
  for (const s of nameStems) if (messageStems.has(s)) score += 3;

  const descStems = new Set(tokenize(flow.description).map(stem));
  for (const s of descStems) if (messageStems.has(s)) score += 1;

  // Builder conditions sharpen the keyword match: descriptions score like the
  // flow description, positive examples like built-in trigger phrases.
  //
  // Only the semantic kind participates. Keyword-scoring a URL pattern would
  // tokenize `.*/courses/.*` against the user's message; objective conditions
  // have already been gated upstream in `messageFlowCandidates` (spec #550).
  const conditionScores: number[] = [];
  for (const condition of flow.conditions ?? []) {
    if (condition.kind !== "conversation_context") continue;
    let conditionScore = 0;
    const condStems = new Set(tokenize(condition.description).map(stem));
    for (const s of condStems) if (messageStems.has(s)) conditionScore += 1;
    for (const example of condition.examples) {
      const phrase = normalize(example.message);
      if (!phrase || !message.includes(phrase)) continue;
      if (!example.shouldTrigger) {
        conditionScore = Number.NEGATIVE_INFINITY;
        break;
      }
      conditionScore += 6;
    }
    conditionScores.push(conditionScore);
  }
  if (conditionScores.length > 0) {
    const matches = conditionScores.map((conditionScore) => conditionScore > 0);
    const conditionsPass =
      (flow.conditionLogic ?? "any") === "all"
        ? matches.every(Boolean)
        : matches.some(Boolean);
    if (!conditionsPass) return Number.NEGATIVE_INFINITY;
    score += conditionScores
      .filter(Number.isFinite)
      .reduce((total, conditionScore) => total + conditionScore, 0);
  }

  const triggers = BUILT_IN_TRIGGERS[normalize(flow.name)];
  if (triggers) {
    for (const phrase of triggers.phrases) {
      if (message.includes(phrase)) score += 6;
    }
    const triggerStems = new Set(triggers.tokens.map(stem));
    for (const s of triggerStems) if (messageStems.has(s)) score += 2;
  }

  return score;
}

const MATCH_THRESHOLD = 3;

/**
 * Enabled message flows in the exact priority order used by every router.
 *
 * The one funnel both engines share, and therefore the one place the objective
 * condition gate belongs: a Flow whose URL or Schedule conditions cannot pass is
 * not a candidate here, so neither the keyword router below nor the LLM
 * classifier in `@agent-hub/agent` ever sees it, and the two cannot drift
 * (spec #550). Omitting `context` leaves objective conditions unevaluatable,
 * which never disqualifies — an unwired caller keeps the previous behaviour.
 */
export function messageFlowCandidates(
  flows: Flow[],
  context: FlowRoutingContext = {}
): Flow[] {
  return flows
    .filter(
      (flow) =>
        flow.enabled &&
        !flow.isDefault &&
        (flow.trigger ?? "message") === "message" &&
        flowConditionsAllowRouting(flow, context)
    )
    .sort((a, b) => a.position - b.position);
}

/**
 * Evaluates enabled message flows in configured priority order and returns
 * the first match, or the default flow when nothing clears the threshold.
 */
export function matchFlow(
  message: string,
  flows: Flow[],
  context: FlowRoutingContext = {}
): Flow | null {
  const normalized = normalize(message);
  const messageStems = new Set(tokenize(message).map(stem));

  // Only message-triggered flows compete for user messages; flows fired by
  // page/chat events never match here.
  const candidates = messageFlowCandidates(flows, context);

  // Priority is authoritative: the first matching flow wins. This makes the
  // order configured in the Flows screen meaningful when intents overlap.
  for (const flow of candidates) {
    const score = scoreFlow(normalized, messageStems, flow);
    if (score >= MATCH_THRESHOLD) return flow;
  }
  return flows.find((f) => f.isDefault && f.enabled) ?? null;
}
