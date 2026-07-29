import {
  flowConditionsAllowRouting,
  type FlowRoutingContext,
} from "./flow-conditions";
import type {
  Flow,
  FlowAction,
  FlowTrigger,
  NotificationDeliveryRule,
} from "./types";

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

/** Whether a trigger fires from a client event rather than a Visitor message. */
export function isProactiveTrigger(trigger: FlowTrigger): boolean {
  return trigger !== "message";
}

/**
 * Which Flow Actions a trigger may run. A proactive Flow has no message to
 * answer, so the reactive catalog (retrieval, escalation, handover, …) cannot
 * apply; conversely a Notification is unprompted by definition and has no
 * meaning as a reply. Enforced at save time *and* at dispatch — the editor is
 * only the first of the two gates.
 */
export function actionAllowedForTrigger(
  action: FlowAction,
  trigger: FlowTrigger
): boolean {
  return isProactiveTrigger(trigger)
    ? action === "notification"
    : action !== "notification";
}

/** Shipped dwell for a new Time-on-page flow, in seconds. */
export const DEFAULT_DWELL_SECONDS = 30;

/**
 * How long a Time-on-page flow waits, in seconds. A flow with no stored dwell
 * (or a nonsensical one) reads as the shipped default rather than as zero —
 * zero would silently turn "Time on page" into "On page load".
 */
export function flowDwellSeconds(flow: Flow): number {
  const dwell = flow.triggerSettings?.timeOnPage;
  const minutes = Number(dwell?.minutes ?? 0);
  const seconds = Number(dwell?.seconds ?? 0);
  const total =
    (Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0) * 60 +
    (Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0);
  return total > 0 ? total : DEFAULT_DWELL_SECONDS;
}

/** The distinct dwell thresholds an assistant's Time-on-page flows use, ascending. */
export function proactiveDwellSeconds(flows: Flow[]): number[] {
  const dwells = proactiveFlowCandidates(flows, "time_on_page", {
    // Selection only — the dwell filter is what we are enumerating.
    elapsedSeconds: Number.POSITIVE_INFINITY,
  }).map(flowDwellSeconds);
  return [...new Set(dwells)].sort((a, b) => a - b);
}

/**
 * What the fired event knows about itself: the routing facts every candidate
 * funnel evaluates (page URL, clock — spec #550), plus the dwell only a
 * Time-on-page report carries.
 */
export interface ProactiveTriggerContext extends FlowRoutingContext {
  /**
   * Seconds the Visitor has spent on the page, as reported by the client. A hint
   * that gets re-checked here, never trusted as a decision: absent means "not
   * measured", which no Time-on-page flow can clear.
   */
  elapsedSeconds?: number;
}

/**
 * The flows a fired proactive trigger runs, in configured order.
 *
 * The mirror of `messageFlowCandidates`, with one deliberate difference: every
 * candidate fires, rather than the first match winning. These are announcements,
 * not answers, so "two nudges configured for chat-open" means two nudges.
 *
 * A flow whose actions don't belong to its trigger is skipped rather than
 * half-run — the same rule the editor and the save path enforce, applied again
 * here so stored data can never make the runtime do something the UI forbids.
 *
 * For `time_on_page` the dwell is re-checked against the reported elapsed time,
 * so a client that under-reports (or replays an old report) cannot make a flow
 * fire early. It fails closed: no measure, no delivery.
 *
 * The objective condition gate (#550) applies here too. A proactive Flow has no
 * conditions today — the editor offers none — so this is a no-op in practice, but
 * a stored URL or Schedule condition must bind the same way on both funnels
 * rather than being silently ignored on one of them.
 */
export function proactiveFlowCandidates(
  flows: Flow[],
  trigger: FlowTrigger,
  context: ProactiveTriggerContext = {}
): Flow[] {
  if (!isProactiveTrigger(trigger)) return [];
  const elapsed = Number(context.elapsedSeconds ?? 0);
  return flows
    .filter(
      (flow) =>
        flow.enabled &&
        !flow.isDefault &&
        (flow.trigger ?? "message") === trigger &&
        (flow.actions ?? []).length > 0 &&
        (flow.actions ?? []).every((action) =>
          actionAllowedForTrigger(action, trigger)
        ) &&
        flowConditionsAllowRouting(flow, context) &&
        // NaN (a garbled report) fails this comparison, which is the intent.
        (trigger !== "time_on_page" || elapsed >= flowDwellSeconds(flow))
    )
    .sort((a, b) => a.position - b.position);
}

/**
 * Which proactive triggers a published Assistant actually has flows for.
 *
 * The embed reads this from the widget config to decide which listeners to arm,
 * so an Assistant with no proactive flows costs its host page nothing: no timers,
 * no reports, no requests. It is a capability hint, never an authorization — the
 * runtime re-selects the flows itself when an event is reported.
 */
export function proactiveTriggers(flows: Flow[]): FlowTrigger[] {
  const triggers: FlowTrigger[] = ["page_load", "time_on_page", "chat_open"];
  return triggers.filter(
    (trigger) =>
      // Enumerating what exists, not what may fire now: no dwell has elapsed yet.
      proactiveFlowCandidates(flows, trigger, {
        elapsedSeconds: Number.POSITIVE_INFINITY,
      }).length > 0
  );
}

/** Where per-conversation proactive delivery counts live in `sessionState`. */
const PROACTIVE_STATE_KEY = "proactive";

/** Deliveries of each flow recorded in one Conversation's session state. */
function deliveredCounts(
  sessionState: Record<string, unknown>
): Record<string, unknown> {
  const raw = sessionState[PROACTIVE_STATE_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function deliveryCount(
  sessionState: Record<string, unknown>,
  flowId: string
): number {
  const value = deliveredCounts(sessionState)[flowId];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A Notification's delivery rule; an unset rule is the safe once-per-session. */
export function notificationDeliveryRule(flow: Flow): NotificationDeliveryRule {
  const rule = flow.actionSettings?.notification?.deliveryRule;
  return rule === "visitor" || rule === "always" ? rule : "session";
}

/** What a delivery decision is made against. */
export interface NotificationDeliveryContext {
  /** Session state of the Conversation the nudge would land in. */
  sessionState: Record<string, unknown>;
  /**
   * Session states of the same Visitor's other Conversations. Needed only by the
   * `visitor` rule; absent behaves as "none known", so a caller that cannot look
   * them up degrades to per-session behaviour rather than to unlimited delivery.
   */
  visitorStates?: Array<Record<string, unknown>>;
}

/**
 * Whether a proactive Flow may deliver here, and the session-state patch to
 * persist when it does.
 *
 * The decision is the server's, never the client's: a reopen loop or a replayed
 * event report re-asks this question and gets the same answer. The count — not a
 * boolean — is what gets stored, so `always` still leaves a usable record.
 */
export function notificationDelivery(
  flow: Flow,
  context: NotificationDeliveryContext
): { deliver: boolean; sessionPatch?: Record<string, unknown> } {
  const { sessionState, visitorStates = [] } = context;
  const rule = notificationDeliveryRule(flow);
  const here = deliveryCount(sessionState, flow.id);
  const delivered =
    rule === "always"
      ? false
      : here > 0 ||
        (rule === "visitor" &&
          visitorStates.some((state) => deliveryCount(state, flow.id) > 0));
  if (delivered) return { deliver: false };
  return {
    deliver: true,
    sessionPatch: {
      [PROACTIVE_STATE_KEY]: {
        ...deliveredCounts(sessionState),
        [flow.id]: here + 1,
      },
    },
  };
}

/** Whether any of these flows needs the Visitor's other Conversations read. */
export function needsVisitorDeliveryHistory(flows: Flow[]): boolean {
  return flows.some((flow) => notificationDeliveryRule(flow) === "visitor");
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
