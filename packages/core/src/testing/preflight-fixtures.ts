import type { DecisionConfidence } from "../decision";
import {
  FLOW_DEFAULT,
  FLOW_OTHER,
  LANGUAGE_MIXED,
  LANGUAGE_OTHER,
  NONE,
  PREFLIGHT_LANGUAGES,
  REASONING_LEVELS,
  FRUSTRATION_LEVELS,
  type PreflightAnswers,
  type PreflightCatalogue,
  type PreflightLanguage,
  type PreflightRouting,
  type ReasoningLevel,
} from "../preflight";
import type { Flow } from "../types";

/**
 * The pre-flight's labelled set (#951): messages a native speaker labelled by
 * hand, with the answers the decision model is expected to give and the
 * outcome the derivations must produce from them.
 *
 * Two tests replay it. `preflight.test.ts` (this package) runs the pure
 * derivations over the labelled answers, so a threshold or criterion change
 * that flips a labelled outcome fails the build. `preflight-replay.test.ts`
 * (`packages/agent`) pushes the same answers through the AI SDK's evaluation
 * mock and `decide()`, so every labelled distribution also has to pass the
 * SDK's own validation (probabilities that sum to one, a choice that is the
 * maximum, a score that is the weighted mean). The keyed replay script in that
 * package runs the same messages against the real model and reports accuracy
 * against these labels.
 *
 * The labels are the ground truth and are written out in full on purpose: a
 * case whose expectation was derived by the function under test would test
 * nothing. Borderline cases sit deliberately just above and just below each
 * threshold, which is what makes a threshold change visible.
 */

const flow = (overrides: Partial<Flow> & Pick<Flow, "id" | "name" | "description">): Flow => ({
  assistantId: "assistant-fixture",
  builtIn: false,
  enabled: true,
  position: 1,
  trigger: "message",
  triggerSettings: {},
  conditionLogic: "any",
  conditions: [],
  actions: ["search_knowledge"],
  actionSettings: {},
  customMessage: "",
  isDefault: false,
  ...overrides,
});

/** One Assistant's worth of routing surface, in both languages. */
export const PREFLIGHT_FIXTURE_CATALOGUE: PreflightCatalogue = {
  flows: [
    flow({
      id: "password_reset",
      name: "Password reset",
      description: "The visitor cannot sign in, or reports a password or credential error.",
      position: 1,
      conditions: [
        {
          id: "cc-1",
          kind: "conversation_context",
          description: "Login and credential problems, not general site errors.",
          examples: [
            { message: "non riesco ad accedere", note: "cannot sign in", shouldTrigger: true },
            { message: "il sito è lento", note: "performance, not access", shouldTrigger: false },
          ],
        },
      ],
    }),
    flow({
      id: "refund_policy",
      name: "Refund policy",
      description: "The visitor asks about refunds, double charges, invoices or payments.",
      position: 2,
      actions: ["custom_message"],
    }),
  ],
  faqs: [
    { id: "faq_hours", question: "Quali sono gli orari della segreteria?" },
    { id: "faq_password", question: "How do I reset my password?" },
    { id: "faq_invoice", question: "Dove trovo le mie fatture?" },
  ],
  desks: [
    { id: "desk_it", name: "IT help desk", description: "Account, login, password and device problems." },
    { id: "desk_admin", name: "Administrative office", description: "Enrolment, fees, invoices, certificates." },
  ],
};

const FLOW_OPTIONS = [
  ...PREFLIGHT_FIXTURE_CATALOGUE.flows.map((f) => f.id),
  FLOW_DEFAULT,
  FLOW_OTHER,
];
const FAQ_OPTIONS = [...PREFLIGHT_FIXTURE_CATALOGUE.faqs.map((f) => f.id), NONE];
const DESK_OPTIONS = [...PREFLIGHT_FIXTURE_CATALOGUE.desks.map((d) => d.id), NONE];
const LANGUAGE_OPTIONS = [...PREFLIGHT_LANGUAGES, LANGUAGE_MIXED, LANGUAGE_OTHER];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A full distribution over `options` with `chosen` at `p` and the remainder on
 * the first other option, every other option at zero. Two decimals throughout,
 * so it sums to one within the rounding the mock declares.
 */
function choice<O extends string>(options: readonly O[], chosen: O, p: number) {
  const runnerUp = options.find((o) => o !== chosen);
  const probabilities: Record<string, number> = {};
  for (const option of options) probabilities[option] = 0;
  probabilities[chosen] = round2(p);
  if (runnerUp) probabilities[runnerUp] = round2(1 - p);
  return { type: "choice" as const, choice: chosen, probabilities };
}

/** A Score distribution with `level` at `p` and the rest on its neighbour. */
function score(levels: number, level: number, p: number) {
  const neighbour = level + 1 < levels ? level + 1 : level - 1;
  const probabilities: Record<string, number> = {};
  for (let i = 0; i < levels; i += 1) probabilities[String(i)] = 0;
  probabilities[String(level)] = round2(p);
  probabilities[String(neighbour)] = round2(1 - p);
  return {
    type: "score" as const,
    score: round2(level * round2(p) + neighbour * round2(1 - p)),
    probabilities,
  };
}

export interface PreflightLabelledCase {
  id: string;
  message: string;
  /** The language the message was written in, as the labeller saw it. */
  language: PreflightLanguage;
  answers: PreflightAnswers;
  confidence: DecisionConfidence;
  expected: {
    routing: PreflightRouting;
    /** What `spokenLanguage` must return: null for mixed, other, or unsure. */
    language: PreflightLanguage | null;
    reasoning: ReasoningLevel;
    /** 0 calm, 1 mildly annoyed, 2 clearly frustrated, 3 angry. */
    frustration: number;
    wantsHuman: boolean;
  };
}

interface CaseSpec {
  id: string;
  message: string;
  language: PreflightLanguage;
  flow: [option: string, confidence: number];
  faq: [option: string, confidence: number];
  wantsHuman: number;
  desk: [option: string, confidence: number];
  reasoning: [level: 0 | 1 | 2, confidence: number];
  frustration: [level: 0 | 1 | 2 | 3, confidence: number];
  spoken: [option: string, confidence: number];
  expected: PreflightLabelledCase["expected"];
}

function labelled(spec: CaseSpec): PreflightLabelledCase {
  return {
    id: spec.id,
    message: spec.message,
    language: spec.language,
    answers: {
      flow: choice(FLOW_OPTIONS, spec.flow[0], spec.flow[1]),
      faq: choice(FAQ_OPTIONS, spec.faq[0], spec.faq[1]),
      wants_human: { type: "boolean", probability: spec.wantsHuman },
      desk: choice(DESK_OPTIONS, spec.desk[0], spec.desk[1]),
      reasoning: score(REASONING_LEVELS.length, spec.reasoning[0], spec.reasoning[1]),
      frustration: score(FRUSTRATION_LEVELS, spec.frustration[0], spec.frustration[1]),
      language: choice(LANGUAGE_OPTIONS, spec.spoken[0], spec.spoken[1]),
    },
    confidence: {
      flow: spec.flow[1],
      faq: spec.faq[1],
      desk: spec.desk[1],
      reasoning: spec.reasoning[1],
      frustration: spec.frustration[1],
      language: spec.spoken[1],
    },
    expected: spec.expected,
  };
}

const escalation = (deskId: string | null): PreflightRouting => ({ kind: "escalation", deskId });
const faq = (faqId: string): PreflightRouting => ({ kind: "faq", faqId });
const toFlow = (flowId: string): PreflightRouting => ({ kind: "flow", flowId });
const search: PreflightRouting = { kind: "knowledge_search" };
const fallback = (reason: Extract<PreflightRouting, { kind: "fallback" }>["reason"]): PreflightRouting => ({
  kind: "fallback",
  reason,
});

export const PREFLIGHT_LABELLED_CASES: readonly PreflightLabelledCase[] = [
  // ── Italian ────────────────────────────────────────────────────────────────
  labelled({
    id: "it-01", language: "it",
    message: "Ciao, non riesco più ad accedere al portale, mi dà errore di password. Con chi posso parlare?",
    flow: ["password_reset", 0.9], faq: [NONE, 0.85], wantsHuman: 0.98, desk: ["desk_it", 0.9],
    reasoning: [0, 0.8], frustration: [1, 0.9], spoken: ["it", 0.99],
    expected: { routing: escalation("desk_it"), language: "it", reasoning: "lookup", frustration: 1, wantsHuman: true },
  }),
  labelled({
    id: "it-02", language: "it",
    message: "Non riesco ad accedere, mi dice password errata",
    flow: ["password_reset", 0.95], faq: [NONE, 0.8], wantsHuman: 0.05, desk: [NONE, 0.9],
    reasoning: [0, 0.85], frustration: [1, 0.85], spoken: ["it", 0.99],
    expected: { routing: toFlow("password_reset"), language: "it", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "it-03", language: "it",
    message: "Come faccio a reimpostare la password?",
    flow: ["password_reset", 0.85], faq: ["faq_password", 0.95], wantsHuman: 0.03, desk: [NONE, 0.95],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["it", 0.99],
    expected: { routing: faq("faq_password"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-04", language: "it",
    message: "Quali sono gli orari della segreteria?",
    flow: [FLOW_DEFAULT, 0.9], faq: ["faq_hours", 0.97], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.95], frustration: [0, 0.95], spoken: ["it", 0.99],
    expected: { routing: faq("faq_hours"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-05", language: "it",
    message: "Dove trovo le mie fatture?",
    flow: ["refund_policy", 0.6], faq: ["faq_invoice", 0.96], wantsHuman: 0.02, desk: [NONE, 0.9],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["it", 0.99],
    expected: { routing: faq("faq_invoice"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-06", language: "it",
    message: "Quando scade l'iscrizione al secondo anno?",
    flow: [FLOW_DEFAULT, 0.92], faq: [NONE, 0.9], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["it", 0.99],
    expected: { routing: search, language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-07", language: "it",
    message: "Vorrei sapere come funziona il rimborso se ho pagato con carta",
    flow: ["refund_policy", 0.88], faq: [NONE, 0.85], wantsHuman: 0.04, desk: [NONE, 0.9],
    reasoning: [1, 0.85], frustration: [0, 0.9], spoken: ["it", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "it", reasoning: "explanation", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-08", language: "it",
    message: "Voglio parlare con un operatore",
    flow: [FLOW_OTHER, 0.7], faq: [NONE, 0.95], wantsHuman: 0.99, desk: [NONE, 0.6],
    reasoning: [0, 0.7], frustration: [1, 0.7], spoken: ["it", 0.99],
    expected: { routing: escalation(null), language: "it", reasoning: "lookup", frustration: 1, wantsHuman: true },
  }),
  labelled({
    id: "it-09", language: "it",
    message: "È la terza volta che scrivo!! nessuno mi risponde, voglio parlare con qualcuno",
    flow: [FLOW_OTHER, 0.6], faq: [NONE, 0.95], wantsHuman: 0.97, desk: [NONE, 0.5],
    reasoning: [0, 0.7], frustration: [2, 0.9], spoken: ["it", 0.99],
    expected: { routing: escalation(null), language: "it", reasoning: "lookup", frustration: 2, wantsHuman: true },
  }),
  labelled({
    id: "it-10", language: "it",
    message: "Basta, chiudo l'account, ridatemi i soldi",
    flow: ["refund_policy", 0.7], faq: [NONE, 0.9], wantsHuman: 0.4, desk: [NONE, 0.7],
    reasoning: [1, 0.6], frustration: [3, 0.92], spoken: ["it", 0.99],
    // The Flow is plausible but the model is not sure enough: today's path.
    expected: { routing: fallback("under_threshold"), language: "it", reasoning: "explanation", frustration: 3, wantsHuman: false },
  }),
  labelled({
    id: "it-11", language: "it",
    message: "buongiorno, avrei una domanda sulle tasse universitarie",
    flow: [FLOW_DEFAULT, 0.75], faq: [NONE, 0.9], wantsHuman: 0.05, desk: [NONE, 0.9],
    reasoning: [0, 0.6], frustration: [0, 0.95], spoken: ["it", 0.99],
    // 0.75 sits just under the 0.8 flow threshold: a threshold move flips this case.
    expected: { routing: fallback("under_threshold"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-12", language: "it",
    message: "mi conviene il piano annuale o mensile nel mio caso?",
    flow: [FLOW_DEFAULT, 0.83], faq: [NONE, 0.9], wantsHuman: 0.03, desk: [NONE, 0.9],
    reasoning: [2, 0.88], frustration: [0, 0.95], spoken: ["it", 0.99],
    expected: { routing: search, language: "it", reasoning: "judgment", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-13", language: "it",
    message: "ho un problema",
    flow: [FLOW_OTHER, 0.85], faq: [NONE, 0.95], wantsHuman: 0.2, desk: [NONE, 0.8],
    reasoning: [0, 0.6], frustration: [1, 0.6], spoken: ["it", 0.98],
    // Confidently "none of the above": today's classifier gets to read it.
    expected: { routing: fallback("other"), language: "it", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "it-14", language: "it",
    message: "Il sito non carica, sarà un problema del mio computer?",
    flow: [FLOW_DEFAULT, 0.82], faq: [NONE, 0.9], wantsHuman: 0.05, desk: [NONE, 0.85],
    reasoning: [1, 0.8], frustration: [1, 0.7], spoken: ["it", 0.99],
    expected: { routing: search, language: "it", reasoning: "explanation", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "it-15", language: "it",
    message: "come si cambia la password? grazie mille",
    flow: ["password_reset", 0.85], faq: ["faq_password", 0.85], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["it", 0.99],
    // Exactly at the 0.85 FAQ threshold: at-threshold clears.
    expected: { routing: faq("faq_password"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-16", language: "it",
    message: "come si cambia password dall'app mobile?",
    flow: ["password_reset", 0.86], faq: ["faq_password", 0.83], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.85], frustration: [0, 0.95], spoken: ["it", 0.99],
    // 0.83 is under the 0.85 FAQ threshold: the curated answer might not cover the app.
    expected: { routing: toFlow("password_reset"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-17", language: "it",
    message: "Salve, potrei avere un certificato di iscrizione? con chi devo parlare?",
    flow: [FLOW_DEFAULT, 0.6], faq: [NONE, 0.9], wantsHuman: 0.9, desk: ["desk_admin", 0.92],
    reasoning: [0, 0.8], frustration: [0, 0.95], spoken: ["it", 0.99],
    expected: { routing: escalation("desk_admin"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: true },
  }),
  labelled({
    id: "it-18", language: "it",
    message: "Non ho ricevuto la fattura di marzo, è normale?",
    flow: [FLOW_DEFAULT, 0.84], faq: ["faq_invoice", 0.6], wantsHuman: 0.05, desk: [NONE, 0.85],
    reasoning: [0, 0.75], frustration: [1, 0.8], spoken: ["it", 0.99],
    expected: { routing: search, language: "it", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "it-19", language: "it",
    message: "Ciao! Grazie mille per l'aiuto di ieri",
    flow: [FLOW_OTHER, 0.9], faq: [NONE, 0.98], wantsHuman: 0.01, desk: [NONE, 0.98],
    reasoning: [0, 0.9], frustration: [0, 0.98], spoken: ["it", 0.99],
    expected: { routing: fallback("other"), language: "it", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "it-20", language: "it",
    message: "Vorrei un rimborso, mi hanno addebitato due volte!!",
    flow: ["refund_policy", 0.93], faq: [NONE, 0.9], wantsHuman: 0.1, desk: [NONE, 0.8],
    reasoning: [1, 0.7], frustration: [2, 0.85], spoken: ["it", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "it", reasoning: "explanation", frustration: 2, wantsHuman: false },
  }),
  labelled({
    id: "it-21", language: "it",
    message: "Hi, non riesco a fare il login, can you help?",
    flow: ["password_reset", 0.9], faq: [NONE, 0.85], wantsHuman: 0.3, desk: [NONE, 0.7],
    reasoning: [0, 0.85], frustration: [1, 0.7], spoken: [LANGUAGE_MIXED, 0.8],
    // A real mix: no spoken language, so the Thinking line falls back to the chat locale.
    expected: { routing: toFlow("password_reset"), language: null, reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  // ── English ────────────────────────────────────────────────────────────────
  labelled({
    id: "en-01", language: "en",
    message: "I can't log in, it keeps saying wrong password. Who can I talk to?",
    flow: ["password_reset", 0.9], faq: [NONE, 0.85], wantsHuman: 0.97, desk: ["desk_it", 0.9],
    reasoning: [0, 0.8], frustration: [1, 0.9], spoken: ["en", 0.99],
    expected: { routing: escalation("desk_it"), language: "en", reasoning: "lookup", frustration: 1, wantsHuman: true },
  }),
  labelled({
    id: "en-02", language: "en",
    message: "My password isn't accepted",
    flow: ["password_reset", 0.95], faq: [NONE, 0.8], wantsHuman: 0.05, desk: [NONE, 0.9],
    reasoning: [0, 0.85], frustration: [1, 0.8], spoken: ["en", 0.99],
    expected: { routing: toFlow("password_reset"), language: "en", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "en-03", language: "en",
    message: "How do I reset my password?",
    flow: ["password_reset", 0.85], faq: ["faq_password", 0.98], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["en", 0.99],
    expected: { routing: faq("faq_password"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-04", language: "en",
    message: "What are the office hours?",
    flow: [FLOW_DEFAULT, 0.9], faq: ["faq_hours", 0.95], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.95], frustration: [0, 0.95], spoken: ["en", 0.99],
    // The curated FAQ is written in Italian; the question is the same question.
    expected: { routing: faq("faq_hours"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-05", language: "en",
    message: "Where can I find my invoices?",
    flow: ["refund_policy", 0.6], faq: ["faq_invoice", 0.96], wantsHuman: 0.02, desk: [NONE, 0.9],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["en", 0.99],
    expected: { routing: faq("faq_invoice"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-06", language: "en",
    message: "When is the enrolment deadline for second year?",
    flow: [FLOW_DEFAULT, 0.93], faq: [NONE, 0.9], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["en", 0.99],
    expected: { routing: search, language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-07", language: "en",
    message: "How does the refund work if I paid by card?",
    flow: ["refund_policy", 0.89], faq: [NONE, 0.85], wantsHuman: 0.03, desk: [NONE, 0.9],
    reasoning: [1, 0.85], frustration: [0, 0.9], spoken: ["en", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "en", reasoning: "explanation", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-08", language: "en",
    message: "I need a human",
    flow: [FLOW_OTHER, 0.7], faq: [NONE, 0.95], wantsHuman: 0.99, desk: [NONE, 0.6],
    reasoning: [0, 0.7], frustration: [1, 0.7], spoken: ["en", 0.99],
    expected: { routing: escalation(null), language: "en", reasoning: "lookup", frustration: 1, wantsHuman: true },
  }),
  labelled({
    id: "en-09", language: "en",
    message: "I have been waiting for days, this is ridiculous. Get me someone.",
    flow: [FLOW_OTHER, 0.6], faq: [NONE, 0.95], wantsHuman: 0.96, desk: [NONE, 0.5],
    reasoning: [0, 0.7], frustration: [2, 0.9], spoken: ["en", 0.99],
    expected: { routing: escalation(null), language: "en", reasoning: "lookup", frustration: 2, wantsHuman: true },
  }),
  labelled({
    id: "en-10", language: "en",
    message: "I want my money back or I'm reporting you",
    flow: ["refund_policy", 0.9], faq: [NONE, 0.9], wantsHuman: 0.3, desk: [NONE, 0.7],
    reasoning: [1, 0.6], frustration: [3, 0.93], spoken: ["en", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "en", reasoning: "explanation", frustration: 3, wantsHuman: false },
  }),
  labelled({
    id: "en-11", language: "en",
    message: "hi, quick question about tuition fees",
    flow: [FLOW_DEFAULT, 0.79], faq: [NONE, 0.9], wantsHuman: 0.05, desk: [NONE, 0.9],
    reasoning: [0, 0.6], frustration: [0, 0.95], spoken: ["en", 0.99],
    // 0.79 against a 0.8 threshold: the closest borderline in the set.
    expected: { routing: fallback("under_threshold"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-12", language: "en",
    message: "Should I file a complaint or wait for the review?",
    flow: [FLOW_DEFAULT, 0.84], faq: [NONE, 0.9], wantsHuman: 0.04, desk: [NONE, 0.9],
    reasoning: [2, 0.9], frustration: [1, 0.6], spoken: ["en", 0.99],
    expected: { routing: search, language: "en", reasoning: "judgment", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "en-13", language: "en",
    message: "something's wrong",
    flow: [FLOW_OTHER, 0.82], faq: [NONE, 0.95], wantsHuman: 0.2, desk: [NONE, 0.8],
    reasoning: [0, 0.6], frustration: [1, 0.6], spoken: ["en", 0.98],
    expected: { routing: fallback("other"), language: "en", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "en-14", language: "en",
    message: "The page won't load, is it my computer?",
    flow: [FLOW_DEFAULT, 0.81], faq: [NONE, 0.9], wantsHuman: 0.05, desk: [NONE, 0.85],
    reasoning: [1, 0.8], frustration: [1, 0.7], spoken: ["en", 0.99],
    expected: { routing: search, language: "en", reasoning: "explanation", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "en-15", language: "en",
    message: "how to change password? thanks a lot",
    flow: ["password_reset", 0.85], faq: ["faq_password", 0.86], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.9], frustration: [0, 0.95], spoken: ["en", 0.99],
    // Just over the 0.85 FAQ threshold.
    expected: { routing: faq("faq_password"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-16", language: "en",
    message: "how do I change my password from the mobile app?",
    flow: ["password_reset", 0.85], faq: ["faq_password", 0.82], wantsHuman: 0.02, desk: [NONE, 0.95],
    reasoning: [0, 0.85], frustration: [0, 0.95], spoken: ["en", 0.99],
    // Just under the 0.85 FAQ threshold: the app question may not be the curated one.
    expected: { routing: toFlow("password_reset"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-17", language: "en",
    message: "Hello, could I get an enrolment certificate? Who should I ask?",
    flow: [FLOW_DEFAULT, 0.6], faq: [NONE, 0.9], wantsHuman: 0.9, desk: ["desk_admin", 0.93],
    reasoning: [0, 0.8], frustration: [0, 0.95], spoken: ["en", 0.99],
    expected: { routing: escalation("desk_admin"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: true },
  }),
  labelled({
    id: "en-18", language: "en",
    message: "I didn't get March's invoice, is that normal?",
    flow: [FLOW_DEFAULT, 0.85], faq: ["faq_invoice", 0.6], wantsHuman: 0.05, desk: [NONE, 0.85],
    reasoning: [0, 0.75], frustration: [1, 0.8], spoken: ["en", 0.99],
    expected: { routing: search, language: "en", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "en-19", language: "en",
    message: "Hi! Thanks so much for yesterday",
    flow: [FLOW_OTHER, 0.9], faq: [NONE, 0.98], wantsHuman: 0.01, desk: [NONE, 0.98],
    reasoning: [0, 0.9], frustration: [0, 0.98], spoken: ["en", 0.99],
    expected: { routing: fallback("other"), language: "en", reasoning: "lookup", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-20", language: "en",
    message: "I want a refund, I was charged twice!!",
    flow: ["refund_policy", 0.94], faq: [NONE, 0.9], wantsHuman: 0.1, desk: [NONE, 0.8],
    reasoning: [1, 0.7], frustration: [2, 0.86], spoken: ["en", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "en", reasoning: "explanation", frustration: 2, wantsHuman: false },
  }),
  labelled({
    id: "en-21", language: "en",
    message: "Can someone help me with my fees? talk to a person please",
    flow: [FLOW_DEFAULT, 0.5], faq: [NONE, 0.9], wantsHuman: 0.92, desk: ["desk_admin", 0.75],
    reasoning: [0, 0.7], frustration: [1, 0.7], spoken: ["en", 0.99],
    // The desk guess sits under its threshold: escalate, but let the Visitor pick.
    expected: { routing: escalation(null), language: "en", reasoning: "lookup", frustration: 1, wantsHuman: true },
  }),
  labelled({
    id: "fr-01", language: "fr",
    message: "Bonjour, je n'arrive pas à me connecter",
    flow: ["password_reset", 0.9], faq: [NONE, 0.85], wantsHuman: 0.05, desk: [NONE, 0.9],
    reasoning: [0, 0.85], frustration: [1, 0.7], spoken: ["fr", 0.95],
    expected: { routing: toFlow("password_reset"), language: "fr", reasoning: "lookup", frustration: 1, wantsHuman: false },
  }),
  // ── Coverage for the two weak questions (#953) ─────────────────────────────
  //
  // Synthetic, and written to fill a hole the first 43 left: 33 of them asked
  // for a lookup and only 2 for a judgment, while frustration sat at calm in
  // 37 of 43. The two questions the keyed replay measures worst, `reasoning`
  // at 58% and `frustration` at 74%, were therefore the two the build gate
  // barely exercised.
  //
  // **These are a regression gate, never a threshold study.** They are what
  // somebody's idea of a frustrated message looks like, not what a Visitor's
  // is, so a criterion change that breaks one is a real signal while an
  // accuracy computed over them would be a measurement of whoever wrote them.
  // #953's thresholds come from labelled real traffic and from nothing else.
  //
  // Deliberately industry-neutral: billing, access, orders and appointments
  // exist in every vertical, unlike the enrolment wording above.

  // Judgment, calm: the answer has to weigh two options, not look one up.
  labelled({
    id: "it-30", language: "it",
    message: "Ho due abbonamenti attivi sullo stesso indirizzo. Conviene disdirne uno e tenere l'altro, o unirli? Non vorrei perdere lo storico.",
    flow: [FLOW_DEFAULT, 0.88], faq: [NONE, 0.88], wantsHuman: 0.2, desk: [NONE, 0.8],
    reasoning: [2, 0.86], frustration: [0, 0.9], spoken: ["it", 0.99],
    expected: { routing: search, language: "it", reasoning: "judgment", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-30", language: "en",
    message: "We are on the smaller plan and keep hitting the cap in the last week of the month. Is it cheaper to upgrade or to buy the add-on twice a year?",
    flow: [FLOW_DEFAULT, 0.87], faq: [NONE, 0.9], wantsHuman: 0.15, desk: [NONE, 0.85],
    reasoning: [2, 0.88], frustration: [0, 0.92], spoken: ["en", 0.99],
    expected: { routing: search, language: "en", reasoning: "judgment", frustration: 0, wantsHuman: false },
  }),

  // Judgment under real anger: the two weak dimensions at once, which is the
  // combination the first 43 never contained.
  labelled({
    id: "it-31", language: "it",
    message: "È la terza volta che scrivo e nessuno risponde. Adesso ditemi voi se ha senso che io continui a pagare un servizio che non funziona, perché io sono pronto a chiudere tutto e andare altrove.",
    flow: ["refund_policy", 0.64], faq: [NONE, 0.9], wantsHuman: 0.96, desk: ["desk_admin", 0.9],
    reasoning: [2, 0.84], frustration: [3, 0.94], spoken: ["it", 0.99],
    expected: { routing: escalation("desk_admin"), language: "it", reasoning: "judgment", frustration: 3, wantsHuman: true },
  }),
  labelled({
    id: "en-31", language: "en",
    message: "Third time I am writing about this and nobody has answered. Tell me honestly whether it is worth staying with you, because at this point I am ready to cancel everything.",
    flow: ["refund_policy", 0.6], faq: [NONE, 0.9], wantsHuman: 0.95, desk: ["desk_admin", 0.88],
    reasoning: [2, 0.82], frustration: [3, 0.93], spoken: ["en", 0.99],
    expected: { routing: escalation("desk_admin"), language: "en", reasoning: "judgment", frustration: 3, wantsHuman: true },
  }),

  // Explanation, mildly annoyed: the middle of both scales, which had four
  // cases between them.
  labelled({
    id: "it-32", language: "it",
    message: "Mi sono arrivati due addebiti nello stesso giorno. Non capisco perché, me lo spiegate?",
    flow: ["refund_policy", 0.88], faq: ["faq_invoice", 0.62], wantsHuman: 0.3, desk: [NONE, 0.7],
    reasoning: [1, 0.87], frustration: [2, 0.89], spoken: ["it", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "it", reasoning: "explanation", frustration: 2, wantsHuman: false },
  }),
  labelled({
    id: "en-32", language: "en",
    message: "I was charged twice on the same day and the amounts are different. Can somebody explain what happened?",
    flow: ["refund_policy", 0.86], faq: ["faq_invoice", 0.6], wantsHuman: 0.35, desk: [NONE, 0.72],
    reasoning: [1, 0.85], frustration: [2, 0.88], spoken: ["en", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "en", reasoning: "explanation", frustration: 2, wantsHuman: false },
  }),

  // Angry but trivially answerable: frustration high, reasoning low. The pair
  // must not move together, and nothing in the first 43 pulled them apart.
  labelled({
    id: "it-33", language: "it",
    message: "Ma è possibile che per cambiare un indirizzo email debba impazzire?? Dove si fa?!",
    flow: [FLOW_DEFAULT, 0.86], faq: [NONE, 0.86], wantsHuman: 0.25, desk: [NONE, 0.8],
    reasoning: [0, 0.9], frustration: [3, 0.91], spoken: ["it", 0.99],
    expected: { routing: search, language: "it", reasoning: "lookup", frustration: 3, wantsHuman: false },
  }),
  labelled({
    id: "en-33", language: "en",
    message: "Why is changing an email address this hard?! Just tell me where the setting is.",
    flow: [FLOW_DEFAULT, 0.85], faq: [NONE, 0.87], wantsHuman: 0.2, desk: [NONE, 0.82],
    reasoning: [0, 0.91], frustration: [3, 0.9], spoken: ["en", 0.99],
    expected: { routing: search, language: "en", reasoning: "lookup", frustration: 3, wantsHuman: false },
  }),

  // Calm but genuinely hard: the mirror image, so the two are pulled apart in
  // both directions.
  labelled({
    id: "it-34", language: "it",
    message: "Se disdico a metà mese, la fattura successiva viene calcolata sui giorni usati o sull'intero periodo? E il credito residuo resta o si perde?",
    flow: ["refund_policy", 0.89], faq: ["faq_invoice", 0.55], wantsHuman: 0.08, desk: [NONE, 0.88],
    reasoning: [2, 0.87], frustration: [0, 0.93], spoken: ["it", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "it", reasoning: "judgment", frustration: 0, wantsHuman: false },
  }),
  labelled({
    id: "en-34", language: "en",
    message: "If I cancel halfway through the month, is the next invoice pro-rated or charged in full, and does any remaining credit carry over?",
    flow: ["refund_policy", 0.9], faq: ["faq_invoice", 0.5], wantsHuman: 0.06, desk: [NONE, 0.9],
    reasoning: [2, 0.88], frustration: [0, 0.94], spoken: ["en", 0.99],
    expected: { routing: toFlow("refund_policy"), language: "en", reasoning: "judgment", frustration: 0, wantsHuman: false },
  }),

  // Explanation, calm, and an FAQ nearly matches: the case where a curated
  // answer is close but the visitor asked something the FAQ does not cover.
  labelled({
    id: "it-35", language: "it",
    message: "Ho reimpostato la password ma continua a non farmi entrare. Perché?",
    flow: ["password_reset", 0.84], faq: ["faq_password", 0.58], wantsHuman: 0.18, desk: [NONE, 0.76],
    reasoning: [1, 0.86], frustration: [1, 0.88], spoken: ["it", 0.99],
    expected: { routing: toFlow("password_reset"), language: "it", reasoning: "explanation", frustration: 1, wantsHuman: false },
  }),
  labelled({
    id: "en-35", language: "en",
    message: "I reset the password already and it still will not let me in. Why would that happen?",
    flow: ["password_reset", 0.86], faq: ["faq_password", 0.56], wantsHuman: 0.16, desk: [NONE, 0.78],
    reasoning: [1, 0.87], frustration: [1, 0.87], spoken: ["en", 0.99],
    expected: { routing: toFlow("password_reset"), language: "en", reasoning: "explanation", frustration: 1, wantsHuman: false },
  }),

];
