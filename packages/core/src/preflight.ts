import {
  CHOICE_OPTION_CAP,
  clearsThreshold,
  scoreLevel,
  type AnswersFor,
  type DecisionBooleanQuestion,
  type DecisionChoiceQuestion,
  type DecisionConfidence,
  type DecisionScoreQuestion,
} from "./decision";
import type { ConversationPreflightSignals, Flow } from "./types";

/**
 * The **pre-flight** question map (#951, spec #948): the decision that runs
 * once per Visitor message before Intent Classification, every independent
 * question in one call (speculative fan-out, map #937).
 *
 * Everything routing-relevant about the pre-flight lives in this one file and
 * is reviewed like a prompt: the questions, their criteria, the thresholds
 * beside them, the intended model version, and the pure derivations over the
 * answers. Questions are code the team versions, never per-Organization data
 * (#942); the labelled fixtures in `testing/preflight-fixtures.ts` replay on
 * every change, so a criterion or threshold that breaks a labelled case fails
 * the build.
 *
 * Three rules from the map hold throughout: Jev only ever picks among options
 * code supplied, so every choice has an explicit exit; numbers, dates and
 * counts are never questions; and a decision under threshold falls back to
 * today's path, which is what `preflightRouting` returns as `fallback`.
 */

/**
 * The versioned model the map was written and labelled against. Recorded on
 * every decision even where the Gateway cannot confirm it (#940: the Gateway
 * echoes `typesafe-ai/jev` and lists no versioned id), so a change in vendor
 * behaviour is visible as a version change here, not as drift. Bump
 * `PREFLIGHT_MAP_VERSION` with any change to a question, criterion or threshold.
 */
export const PREFLIGHT_MODEL_ID = "jev-1.13.0";
export const PREFLIGHT_MAP_VERSION = 2;

/**
 * The languages the map speaks and the Thinking-line table covers: the same
 * seven the courtesy lexicon knows. An Assistant may narrow the list; it may
 * not widen it without a row in `THINKING_LINES`, which the test enforces.
 */
export type PreflightLanguage = "it" | "en" | "es" | "fr" | "de" | "nl" | "pt";
export const PREFLIGHT_LANGUAGES: readonly PreflightLanguage[] = [
  "it",
  "en",
  "es",
  "fr",
  "de",
  "nl",
  "pt",
];

const LANGUAGE_NAMES: Readonly<Record<PreflightLanguage, string>> = {
  it: "Italian (italiano)",
  en: "English",
  es: "Spanish (español)",
  fr: "French (français)",
  de: "German (Deutsch)",
  nl: "Dutch (Nederlands)",
  pt: "Portuguese (português)",
};

/** The explicit exits: a choice never has to pick a listed option. */
export const FLOW_DEFAULT = "default";
export const FLOW_OTHER = "other";
export const NONE = "none";
export const LANGUAGE_MIXED = "mixed";
export const LANGUAGE_OTHER = "other";

export const REASONING_LEVELS = ["lookup", "explanation", "judgment"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
/** Calm, mildly annoyed, clearly frustrated, angry: four levels, indexed 0–3. */
export const FRUSTRATION_LEVELS = 4;

export const PREFLIGHT_QUESTION_IDS = [
  "flow",
  "faq",
  "wants_human",
  "desk",
  "reasoning",
  "frustration",
  "language",
] as const;
export type PreflightQuestionId = (typeof PREFLIGHT_QUESTION_IDS)[number];

/**
 * Confidence threshold per question, beside the questions on purpose.
 *
 * Set (#953) from the two 193-message replays over the labelled sets on
 * 21 September 2026 (`docs/preflight-labelling.md` §4): the lowest cut with at
 * least 95% precision on at least 20 cases, rounded up where the labelled set
 * could not tell two cuts apart. `flow` held at 0.80 (95% precise, 80% of
 * turns cleared). `faq` came down from 0.90: 0.85 clears 85% of turns at 99%,
 * and going lower waits for live FAQ traffic, since the corpus paraphrases are
 * close to the curated questions. `wants_human` came down from 0.85 because
 * the Boolean had no false positive at any cut and 0.85 was missing one
 * request for a person in seven; 0.75 keeps precision at 100% and recall at
 * 96% on the 28 positives. `desk` and `language` were 100% at every cut and
 * keep their values.
 *
 * **Provisional**, and marked so on the ticket: 150 of the 193 labels are one
 * labeller's, pending the blind two-labeller campaign. The nightly drift
 * replay (`preflight-drift.ts` in the agent package) is what corrects them:
 * a labelled case the model used to route right and now routes wrong raises
 * a `system` Alert. Per language only if the languages differ by more than
 * 0.05 (#938); on 56 English cases `flow` wanted 0.90, too few to act on.
 *
 * The two Score questions carry no threshold: a score is read as a level and
 * never routes on its own.
 */
export const PREFLIGHT_THRESHOLDS: Readonly<Record<PreflightQuestionId, number>> = {
  flow: 0.8,
  faq: 0.85,
  wants_human: 0.75,
  desk: 0.8,
  reasoning: 0,
  frustration: 0,
  language: 0.7,
};

export interface PreflightFaq {
  id: string;
  question: string;
}

export interface PreflightDesk {
  id: string;
  name: string;
  description: string;
}

/**
 * What the pre-flight chooses among. `flows` are the message-triggered
 * candidates the URL and Schedule hard gates admit (`messageFlowCandidates`),
 * never the whole list; `faqs` are already prefiltered in code to the top
 * candidates by vector similarity when the catalogue exceeds the option cap.
 */
export interface PreflightCatalogue {
  flows: readonly Flow[];
  faqs: readonly PreflightFaq[];
  desks: readonly PreflightDesk[];
  /** The Assistant's locales; defaults to every language the map speaks. */
  locales?: readonly string[];
}

// A type alias rather than an interface: only an object type literal carries the
// implicit index signature `AnswersFor` needs to see it as a map of questions.
export type PreflightQuestionMap = {
  readonly flow: DecisionChoiceQuestion;
  readonly faq: DecisionChoiceQuestion;
  readonly wants_human: DecisionBooleanQuestion;
  readonly desk: DecisionChoiceQuestion;
  readonly reasoning: DecisionScoreQuestion;
  readonly frustration: DecisionScoreQuestion;
  readonly language: DecisionChoiceQuestion;
};

export type PreflightAnswers = AnswersFor<PreflightQuestionMap>;

function languagesOf(catalogue: PreflightCatalogue): PreflightLanguage[] {
  const wanted = catalogue.locales ?? PREFLIGHT_LANGUAGES;
  const known = wanted
    .map((locale) => locale.toLowerCase().split("-")[0])
    .filter((code): code is PreflightLanguage =>
      (PREFLIGHT_LANGUAGES as readonly string[]).includes(code)
    );
  return known.length > 0 ? [...new Set(known)] : [...PREFLIGHT_LANGUAGES];
}

/**
 * The one sentence every instruction opens with. Naming the languages the
 * state may be written in is the single documented fix for non-English input
 * (#938: Ukrainian went from 12% to 87% once the instruction said so).
 */
function stateLanguages(languages: readonly PreflightLanguage[]): string {
  const names = languages.map((code) => LANGUAGE_NAMES[code].replace(/ \(.*\)$/, ""));
  return `The visitor's message may be written in ${names.join(", ")}; judge what it asks, whatever the language.`;
}

function flowCriterion(flow: Flow): string {
  const parts = [flow.description.trim() || flow.name.trim()];
  for (const condition of flow.conditions) {
    if (condition.kind !== "conversation_context") continue;
    if (condition.description.trim()) parts.push(condition.description.trim());
    const matching = condition.examples.filter((e) => e.shouldTrigger).map((e) => `"${e.message}"`);
    const notMatching = condition.examples.filter((e) => !e.shouldTrigger).map((e) => `"${e.message}"`);
    if (matching.length) parts.push(`Messages like: ${matching.join(", ")}.`);
    if (notMatching.length) parts.push(`Not messages like: ${notMatching.join(", ")}.`);
  }
  return parts.join(" ");
}

function assertOptionCap(questionId: PreflightQuestionId, count: number): void {
  if (count > CHOICE_OPTION_CAP) {
    throw new RangeError(
      `pre-flight "${questionId}" has ${count} options; the cap is ${CHOICE_OPTION_CAP}. Prefilter the catalogue in code before building the map.`
    );
  }
}

/**
 * Builds the seven questions for one message's catalogue. Criteria describe
 * situations, not degrees; every choice carries its exit; the static questions
 * carry Italian and English examples in their criteria.
 */
export function buildPreflightQuestions(catalogue: PreflightCatalogue): PreflightQuestionMap {
  const languages = languagesOf(catalogue);
  const opening = stateLanguages(languages);

  const flowCriteria: Record<string, string> = {};
  for (const flow of catalogue.flows) flowCriteria[flow.id] = flowCriterion(flow);
  flowCriteria[FLOW_DEFAULT] =
    "A request for facts or information (about a person, product, service, deadline, policy or any content topic) that the knowledge base should answer. Messages like: \"quando scade l'iscrizione?\", \"what are the opening hours?\".";
  flowCriteria[FLOW_OTHER] =
    "None of the situations above applies, or the message is too ambiguous to place.";
  assertOptionCap("flow", Object.keys(flowCriteria).length);

  const faqCriteria: Record<string, string> = {};
  for (const faq of catalogue.faqs) faqCriteria[faq.id] = `The visitor asks, in their own words, the same thing as: "${faq.question}"`;
  faqCriteria[NONE] = "No listed FAQ asks what the visitor asks, or the visitor asks something broader or different.";
  assertOptionCap("faq", Object.keys(faqCriteria).length);

  const deskCriteria: Record<string, string> = {};
  for (const desk of catalogue.desks) {
    deskCriteria[desk.id] = desk.description.trim()
      ? `${desk.name.trim()}: ${desk.description.trim()}`
      : desk.name.trim();
  }
  deskCriteria[NONE] = "The visitor does not need a help desk, or none of the listed desks fits what they need.";
  assertOptionCap("desk", Object.keys(deskCriteria).length);

  const languageCriteria: Record<string, string> = {};
  for (const code of languages) languageCriteria[code] = `The message is written in ${LANGUAGE_NAMES[code]}.`;
  languageCriteria[LANGUAGE_MIXED] = "The message mixes two or more languages in roughly equal measure.";
  languageCriteria[LANGUAGE_OTHER] = "The message is written in a language not listed.";

  return {
    flow: {
      type: "choice",
      instructions: `${opening} Pick the one situation that describes what this visitor wants from the assistant. Each option is a situation, ordered by the organization's priority; a request for facts goes to "${FLOW_DEFAULT}" even when it shares words with another option.`,
      criteria: flowCriteria,
    },
    faq: {
      type: "choice",
      instructions: `${opening} Does the visitor ask the same question as one of these curated FAQs? Pick that FAQ only when the curated answer would answer them fully; otherwise "${NONE}".`,
      criteria: faqCriteria,
    },
    wants_human: {
      type: "boolean",
      instructions: `${opening} Does the visitor ask to be put in touch with a person or a support team?`,
      criteria: {
        true: 'They ask to talk to someone, ask who can help them, or ask for a human. Messages like: "con chi posso parlare?", "voglio parlare con un operatore", "can I talk to someone?", "I need a human".',
        false: 'They describe a problem or ask an informational question without asking for a person. Messages like: "non riesco ad accedere", "how do I reset my password?".',
      },
    },
    desk: {
      type: "choice",
      instructions: `${opening} If the visitor needed a person, which of these help desks fits what they describe? Pick "${NONE}" when they do not need one or none fits.`,
      criteria: deskCriteria,
    },
    reasoning: {
      type: "score",
      instructions: `${opening} How much reasoning does a good answer need?`,
      criteria: [
        'Lookup: one fact or one place answers it. Messages like: "qual è l\'orario della segreteria?", "where is the login page?".',
        'Explanation: several facts have to be put together or a procedure walked through. Messages like: "come faccio a cambiare piano e cosa succede alla fattura?", "how does the refund work if I paid by card?".',
        'Judgment: the answer depends on the visitor\'s situation and weighs options. Messages like: "mi conviene il piano annuale o mensile nel mio caso?", "should I file a complaint or wait for the review?".',
      ],
    },
    frustration: {
      type: "score",
      instructions: `${opening} How frustrated does the visitor sound? Judge tone, not the seriousness of the problem.`,
      criteria: [
        'Calm and neutral. Messages like: "buongiorno, avrei una domanda", "hi, quick question".',
        'Mildly annoyed: a problem stated plainly, perhaps with a "still" or "again". Messages like: "non riesco ancora ad accedere", "it still doesn\'t work".',
        'Clearly frustrated: urgency, repetition, exasperation. Messages like: "è la terza volta che scrivo!!", "I have been waiting for days, this is ridiculous".',
        'Angry, or threatening to leave or to complain. Messages like: "basta, chiudo l\'account", "I want my money back or I\'m reporting you".',
      ],
    },
    language: {
      type: "choice",
      instructions: `Which language is the visitor's message written in? Judge the words, not the topic; pick "${LANGUAGE_MIXED}" for a real mix and "${LANGUAGE_OTHER}" for a language not listed.`,
      criteria: languageCriteria,
    },
  };
}

/**
 * Where the pre-flight sends the message. `fallback` is today's path, Intent
 * Classification and then the keyword matcher, and is the answer whenever the
 * decision is not sure enough to act: under threshold, an unknown option, an
 * explicit exit, or an uncalibrated backend.
 */
export type PreflightRouting =
  | { kind: "escalation"; deskId: string | null }
  | { kind: "faq"; faqId: string }
  | { kind: "flow"; flowId: string }
  | { kind: "knowledge_search" }
  | {
      kind: "fallback";
      reason: "uncalibrated" | "under_threshold" | "other" | "unknown_option";
    };

export interface PreflightDecision {
  answers: PreflightAnswers;
  confidence: DecisionConfidence;
  /** False under the adapter: the pre-flight then informs but never routes (#946). */
  calibrated: boolean;
}

function clears(decision: PreflightDecision, id: PreflightQuestionId): boolean {
  return clearsThreshold({
    answer: decision.answers[id],
    confidence: decision.confidence[id],
    threshold: PREFLIGHT_THRESHOLDS[id],
    calibrated: decision.calibrated,
  });
}

/**
 * The routing derivation, in the precedence the spec fixes: a visitor who asks
 * for a person is escalated before anything else; a curated answer beats a
 * generated one; a listed Flow beats knowledge search; and only a confident
 * `default` sends the message straight to the knowledge base. Everything else
 * is today's path, which is what keeps the pre-flight information-preserving.
 *
 * The chosen ids are validated against the catalogue rather than trusted: an
 * option the model names that code did not supply is not a choice.
 */
export function preflightRouting(
  decision: PreflightDecision,
  catalogue: PreflightCatalogue
): PreflightRouting {
  if (!decision.calibrated) return { kind: "fallback", reason: "uncalibrated" };
  const { answers } = decision;

  if (clears(decision, "wants_human")) {
    const deskId = answers.desk.choice;
    const known = deskId !== NONE && catalogue.desks.some((d) => d.id === deskId);
    return { kind: "escalation", deskId: known && clears(decision, "desk") ? deskId : null };
  }

  const faqId = answers.faq.choice;
  if (faqId !== NONE && clears(decision, "faq")) {
    if (catalogue.faqs.some((f) => f.id === faqId)) return { kind: "faq", faqId };
    return { kind: "fallback", reason: "unknown_option" };
  }

  if (!clears(decision, "flow")) return { kind: "fallback", reason: "under_threshold" };
  const flowId = answers.flow.choice;
  if (flowId === FLOW_OTHER) return { kind: "fallback", reason: "other" };
  if (flowId === FLOW_DEFAULT) return { kind: "knowledge_search" };
  if (catalogue.flows.some((f) => f.id === flowId)) return { kind: "flow", flowId };
  return { kind: "fallback", reason: "unknown_option" };
}

/**
 * One line naming a routing, for an Alert detail or an operator panel. Never
 * shown to a Visitor: it names Flow, FAQ and desk ids, which the Thinking
 * line exists not to.
 */
export function describePreflightRouting(routing: PreflightRouting): string {
  switch (routing.kind) {
    case "escalation":
      return routing.deskId ? `escalation, desk ${routing.deskId}` : "escalation, no desk";
    case "faq":
      return `FAQ ${routing.faqId}`;
    case "flow":
      return `flow ${routing.flowId}`;
    case "knowledge_search":
      return "knowledge search";
    case "fallback":
      return `fallback (${routing.reason})`;
  }
}

/** The level the reasoning Score landed on, as a name. */
export function reasoningLevel(decision: PreflightDecision): ReasoningLevel {
  return REASONING_LEVELS[scoreLevel(decision.answers.reasoning, REASONING_LEVELS.length)];
}

/** The frustration level, 0 (calm) to 3 (angry). */
export function frustrationLevel(decision: PreflightDecision): number {
  return scoreLevel(decision.answers.frustration, FRUSTRATION_LEVELS);
}

/**
 * The language the Visitor wrote in, when the map is sure; `mixed`, `other`
 * and an under-threshold answer read as null so the caller falls back to the
 * Assistant's chat locale. Under the adapter the choice is accepted (#943).
 */
export function spokenLanguage(decision: PreflightDecision): PreflightLanguage | null {
  const choice = decision.answers.language.choice;
  if (!(PREFLIGHT_LANGUAGES as readonly string[]).includes(choice)) return null;
  return clears(decision, "language") ? (choice as PreflightLanguage) : null;
}

/**
 * The outcomes that put a line in the Thinking panel (#946). Basic Interaction
 * and a proactive Notification show nothing, and a `fallback` keeps today's
 * streamed narration, so none of the three is an outcome here.
 */
export type ThinkingOutcome = "knowledge_search" | "faq" | "escalation";

/**
 * The closed table (#946). Keyed by outcome and language, with nothing in it
 * that came from an Organization's configuration: that is the whole rule that
 * keeps a Flow name off a Visitor's screen, and `preflight.test.ts` proves it
 * against a hostile catalogue rather than relying on a runtime filter.
 */
export const THINKING_LINES: Readonly<
  Record<PreflightLanguage, Readonly<Record<ThinkingOutcome, string>>>
> = {
  en: {
    knowledge_search: "Looking this up",
    faq: "I have an answer for that",
    escalation: "Connecting you with support",
  },
  it: {
    knowledge_search: "Sto cercando la risposta",
    faq: "Ho una risposta per questo",
    escalation: "Ti metto in contatto con il supporto",
  },
  es: {
    knowledge_search: "Estoy buscando la respuesta",
    faq: "Tengo una respuesta para eso",
    escalation: "Te pongo en contacto con soporte",
  },
  fr: {
    knowledge_search: "Je cherche la réponse",
    faq: "J'ai une réponse pour cela",
    escalation: "Je vous mets en relation avec le support",
  },
  de: {
    knowledge_search: "Ich suche die Antwort",
    faq: "Dafür habe ich eine Antwort",
    escalation: "Ich verbinde Sie mit dem Support",
  },
  nl: {
    knowledge_search: "Ik zoek het antwoord op",
    faq: "Daar heb ik een antwoord op",
    escalation: "Ik verbind je met de support",
  },
  pt: {
    knowledge_search: "Estou procurando a resposta",
    faq: "Tenho uma resposta para isso",
    escalation: "Vou ligá-lo ao suporte",
  },
};

/**
 * Which line an outcome earns. A routed Flow earns the knowledge-search line
 * only when its actions search knowledge; a Flow that replies verbatim needs
 * no line, its reply is the next thing on screen.
 */
export function thinkingOutcome(
  routing: PreflightRouting,
  catalogue: PreflightCatalogue
): ThinkingOutcome | null {
  switch (routing.kind) {
    case "knowledge_search":
      return "knowledge_search";
    case "faq":
      return "faq";
    case "escalation":
      return "escalation";
    case "flow": {
      const flow = catalogue.flows.find((f) => f.id === routing.flowId);
      return flow?.actions.includes("search_knowledge") ? "knowledge_search" : null;
    }
    case "fallback":
      return null;
  }
}

/**
 * The line itself, in the Visitor's language with the Assistant's chat locale
 * as the fallback and English as the fallback's fallback. Takes no Flow and no
 * Organization data by construction.
 */
export function thinkingLine(
  outcome: ThinkingOutcome,
  language: PreflightLanguage | null,
  fallbackLocale: string | null | undefined
): string {
  const code = language ?? fallbackLocale?.toLowerCase().split("-")[0] ?? "en";
  const table = (THINKING_LINES as Record<string, Record<ThinkingOutcome, string>>)[code];
  return (table ?? THINKING_LINES.en)[outcome];
}

/**
 * What one shadow pre-flight left on the turn's trace (#952).
 *
 * Deliberately **not** a {@link TurnStep}. The Thinking Steps are rendered by
 * one component that the Inbox, the Visitor's widget and the Preview all share,
 * so a step is a step on everyone's screen; a turn the pre-flight only observed
 * must look to a Visitor exactly like a turn without it. Keeping the record off
 * `steps` makes that true by construction rather than by remembering to strip
 * it, which is also why it never travels as a `RuntimeEvent`.
 *
 * Every field is what #953 needs to set a threshold from real traffic: the
 * answer, the confidence the provider gave it, what the pre-flight *would* have
 * done, and what the turn actually did, on the same row.
 */
export interface PreflightTraceRecord {
  /** Bumped with any change to a question, criterion or threshold. */
  mapVersion: number;
  /** The version the map was written against; see {@link PREFLIGHT_MODEL_ID}. */
  mapModelId: string;
  /**
   * What the response named. The Gateway echoes the requested id and hides the
   * resolved version (#940), so this is the id, not a pin.
   */
  resolvedModelId: string;
  backend: "jev" | "adapter";
  /** False under the adapter, where the pre-flight informs and never routes. */
  calibrated: boolean;
  latencyMs: number;
  /** One row per question, in map order, with the confidence as the provider gave it (never rounded). */
  answers: PreflightTraceAnswer[];
  /**
   * What the pre-flight would have done. In this slice nothing acts on it: the
   * Flow in `routedFlowId` is what ran, and the two are on the same record so
   * they can be compared per turn.
   */
  wouldRoute: PreflightRouting;
  /** The Flow the turn actually took, `null` when no flow handled the message. */
  routedFlowId: string | null;
  /**
   * True when the turn went where `wouldRoute` said (#953): the pre-flight
   * routed, Intent Classification never ran, and the Thinking line was the
   * fixed sentence for the outcome. Absent or false on a shadow record, where
   * the two fields above are a comparison and nothing else.
   */
  acted?: boolean;
  /**
   * Set when the decision did not produce answers. The turn is unaffected
   * either way; a failure is recorded rather than swallowed so a backend that
   * is quietly failing reads as failing and not as absent.
   */
  failure?: PreflightFailure;
  /**
   * Present when the FAQ catalogue did not fit {@link CHOICE_OPTION_CAP} and
   * the question was asked over fewer options than the Assistant has. The FAQ
   * answer on such a record is not comparable with the others, which is the
   * whole reason the counts are here.
   */
  faqCatalogue?: {
    total: number;
    offered: number;
    /**
     * True when the offered shortlist was the top candidates by vector
     * similarity to the message (#954) rather than a prefix of the catalogue.
     * A ranked shortlist is one the FAQ answer can be trusted on; a prefix is
     * not, which is why the shadow recorded the counts in the first place.
     */
    ranked?: boolean;
  };
}

export interface PreflightTraceAnswer {
  id: PreflightQuestionId;
  /** The chosen option, the score level, or the boolean, as the answer carried it. */
  value: string | number | boolean;
  /** Absent under the adapter and whenever the provider sent none. */
  confidence?: number;
  /** True when the answer arrived with no probabilities, the fallback's signature. */
  fallback: boolean;
}

export type PreflightFailure =
  | { reason: "timeout"; afterMs: number }
  | { reason: "error"; message: string }
  /** The catalogue could not produce a legal question map, e.g. over the option cap. */
  | { reason: "no_questions"; message: string };

/*
 * There is deliberately no `no_model` failure. A deployment with the flag on
 * and no key would stamp the same row on every trace it ever writes, which is
 * a fact about the deployment and not about the turn; the shadow records
 * nothing at all in that case.
 */


/**
 * Folds one turn's pre-flight record into the Conversation's running signals
 * (#956). Pure, because the fold is the whole rule and a turn should not be
 * where somebody reads how "the language of a conversation" is decided.
 *
 * Each signal folds differently, and the differences are the point:
 *
 * - **Language** takes the majority across turns, not the latest. A Visitor
 *   who writes one English word in an Italian conversation has not switched
 *   language, and "latest wins" would have said they had.
 * - **Escalation intent** is sticky. Somebody who asked for a person and was
 *   then talked out of it still asked, and a card about how often people want
 *   out must not lose them because the next turn went better.
 * - **Frustration** keeps only the last turn, because the question the card
 *   asks is how the conversation *ended*, not how it went throughout.
 * - **The recommended desk** (#955) is the current turn's or nothing: it names
 *   what the latest reply's escalation chip points at, and a turn that did not
 *   recommend clears it, so an escalation several turns later is never judged
 *   "not followed" against a chip that is no longer the latest reply.
 */
export function foldPreflightSignals(
  previous: ConversationPreflightSignals | undefined,
  record: Pick<PreflightTraceRecord, "answers" | "calibrated"> &
    Partial<Pick<PreflightTraceRecord, "acted" | "wouldRoute">>,
  thresholds: Readonly<Record<PreflightQuestionId, number>> = PREFLIGHT_THRESHOLDS
): ConversationPreflightSignals {
  const answer = (id: PreflightQuestionId) =>
    record.answers.find((entry) => entry.id === id);

  const next: ConversationPreflightSignals = { ...previous };

  const language = answer("language");
  if (language && typeof language.value === "string" && language.value !== LANGUAGE_MIXED && language.value !== LANGUAGE_OTHER) {
    const tally = { ...(previous?.languageTally ?? {}) };
    tally[language.value] = (tally[language.value] ?? 0) + 1;
    next.languageTally = tally;
    next.spokenLanguage = Object.entries(tally).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0][0];
  }

  const wantsHuman = answer("wants_human");
  if (wantsHuman && typeof wantsHuman.value === "boolean") {
    // The threshold is read the same way the router reads it, so a card and a
    // routing decision never disagree about what "asked for a person" means.
    const asked =
      wantsHuman.value &&
      (!record.calibrated || (wantsHuman.confidence ?? 0) >= thresholds.wants_human);
    next.escalationIntent = Boolean(previous?.escalationIntent) || asked;
  }

  const frustration = answer("frustration");
  if (frustration && typeof frustration.value === "number") {
    next.endedAtFrustration = Math.round(frustration.value);
  }

  if (record.acted && record.wouldRoute?.kind === "escalation" && record.wouldRoute.deskId) {
    next.recommendedHelpDeskId = record.wouldRoute.deskId;
  } else {
    delete next.recommendedHelpDeskId;
  }

  return next;
}
