import {
  FLOW_DEFAULT,
  FLOW_OTHER,
  LANGUAGE_MIXED,
  LANGUAGE_OTHER,
  NONE,
  PREFLIGHT_LANGUAGES,
  REASONING_LEVELS,
  type PreflightCatalogue,
  type PreflightLanguage,
  type PreflightRouting,
  type ReasoningLevel,
} from "../preflight";
import type { Flow } from "../types";

/**
 * The **synthetic** pre-flight set (#953, stopgap): 150 Visitor messages with
 * gold labels for the seven questions, three quarters Italian, built from a
 * public customer-support corpus so the threshold work can start before the
 * shadow has logged enough real traffic to label.
 *
 * Where it comes from. `packages/agent/scripts/sample-preflight-source.mts`
 * draws 150 rows, seeded and stratified over all 27 intents, from the Bitext
 * customer-support dataset (English, CDLA-Sharing-1.0, 26,872 rows). Each case
 * below names its source row, intent and Bitext flags (`W` offensive language,
 * `Z` typos, `C` colloquial, `P` polite, `K` keywords only). 112 rows were
 * translated into Italian by hand, keeping the register and putting a typo
 * where the source had one; 35 were kept in English with the source's own
 * typos; 3 were rewritten as a real Italian/English mix. Order numbers,
 * amounts and account tiers replace the corpus placeholders. Eleven cases are
 * **augmented** beyond translation, each saying how: a topic clause added so
 * the `desk` question has positive cases (the corpus never names one), a
 * rewrite into a judgment question (the corpus has none), or an elapsed-time
 * clause for a frustration level the sample under-represented.
 *
 * What the labels are. One labeller's gold, not two: `flow`, `faq`,
 * `wants_human` and `desk` follow from the intent under the protocol in
 * `docs/preflight-labelling.md`; `reasoning` and `frustration` are the
 * labeller's reading of each message under the map's own criteria. They are
 * the labels the blind campaign is asked to confirm or overturn, and they are
 * marked `provenance: "synthetic"` so nothing downstream mistakes them for the
 * 400-message human set #953 asks for. Frustration was the hardest question to
 * label and is where the two native speakers are expected to disagree most.
 *
 * What is deliberately absent. No model answers and no confidences: those were
 * the invented numbers this set exists to replace. The keyed replay runs the
 * real model over these messages, compares to the gold, and sweeps thresholds
 * over the confidences it actually reported.
 */

const flow = (overrides: Partial<Flow> & Pick<Flow, "id" | "name" | "description">): Flow => ({
  assistantId: "assistant-synthetic",
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

/**
 * One online-retail Organization's routing surface. Industry-neutral on
 * purpose (orders, accounts, payments, invoices): the corpus is retail, and the
 * map has to work for any vertical the product serves.
 */
export const PREFLIGHT_SYNTHETIC_CATALOGUE: PreflightCatalogue = {
  flows: [
    flow({
      id: "account_access",
      name: "Account access",
      description:
        "The visitor cannot sign in, has lost a password or PIN, or reports a problem registering or creating an account.",
      position: 1,
      conditions: [
        {
          id: "cc-access",
          kind: "conversation_context",
          description: "Sign-in, credential and registration problems, not questions about plans or account settings.",
          examples: [
            { message: "non riesco a registrarmi", note: "cannot register", shouldTrigger: true },
            { message: "come passo all'account premium?", note: "a plan question", shouldTrigger: false },
          ],
        },
      ],
    }),
    flow({
      id: "order_changes",
      name: "Order changes",
      description:
        "The visitor wants to cancel or change an order, or to change or add a delivery address.",
      position: 2,
      actions: ["custom_message"],
      customMessage: "Per annullare o modificare un ordine apri Il mio account → Ordini e scegli l'ordine.",
    }),
    flow({
      id: "refunds",
      name: "Refunds",
      description:
        "The visitor asks for a refund, asks where a refund they are owed is, or asks how refunds work.",
      position: 3,
    }),
    flow({
      id: "payment_issue",
      name: "Payment problems",
      description: "The visitor reports a failed, declined or duplicated payment.",
      position: 4,
    }),
    flow({
      id: "complaint",
      name: "Complaints",
      description: "The visitor wants to file a formal complaint about the company or its service.",
      position: 5,
      actions: ["custom_message"],
      customMessage: "I reclami formali si presentano dal modulo Reclami; riceverai risposta entro 10 giorni.",
    }),
  ],
  faqs: [
    { id: "faq_track_order", question: "Come posso seguire lo stato del mio ordine?" },
    { id: "faq_delivery_time", question: "Quanto tempo impiega la consegna?" },
    { id: "faq_delivery_countries", question: "In quali paesi consegnate?" },
    { id: "faq_payment_methods", question: "Which payment methods do you accept?" },
    { id: "faq_invoice", question: "Dove trovo e scarico le mie fatture?" },
    { id: "faq_refund_policy", question: "In quali casi posso chiedere un rimborso?" },
    { id: "faq_cancellation_fee", question: "Is there a fee for cancelling early?" },
    { id: "faq_password", question: "Come recupero la password o il PIN di accesso?" },
    { id: "faq_contact_hours", question: "Quali sono gli orari del servizio clienti?" },
  ],
  desks: [
    {
      id: "desk_orders",
      name: "Orders and delivery",
      description: "Order changes, cancellations, tracking, delivery problems and returns.",
    },
    {
      id: "desk_billing",
      name: "Billing",
      description: "Payments, refunds, invoices and charges.",
    },
    {
      id: "desk_account",
      name: "Account support",
      description: "Sign-in, password, registration and profile problems.",
    },
  ],
};

export type PreflightGoldLanguage = PreflightLanguage | typeof LANGUAGE_MIXED | typeof LANGUAGE_OTHER;

/** The seven answers a human gives for one message. */
export interface PreflightGoldLabels {
  /** A Flow id from the catalogue, `default` or `other`. */
  flow: string;
  /** An FAQ id from the catalogue or `none`. */
  faq: string;
  wantsHuman: boolean;
  /** A desk id from the catalogue or `none`; only read when `wantsHuman`. */
  desk: string;
  reasoning: ReasoningLevel;
  /** 0 calm, 1 mildly annoyed, 2 clearly frustrated, 3 angry. */
  frustration: 0 | 1 | 2 | 3;
  language: PreflightGoldLanguage;
}

export interface PreflightGoldSource {
  dataset: "bitext-customer-support-27k";
  /** 1-based line in the published CSV, header included. */
  row: number;
  intent: string;
  flags: string;
  /** Present when the message says more than the source row did, and how. */
  augmented?: string;
}

export interface PreflightGoldCase {
  id: string;
  message: string;
  source: PreflightGoldSource;
  labels: PreflightGoldLabels;
  /** `synthetic`: one labeller, pending the blind two-labeller campaign. */
  provenance: "synthetic" | "campaign";
}

/**
 * Where a human says the message should go, from the labels alone and in the
 * spec's precedence: a person before anything, a curated answer before a
 * generated one, a listed Flow before knowledge search. Confidence plays no
 * part; this is the destination the model's routing is measured against.
 */
export function goldRouting(labels: PreflightGoldLabels, catalogue: PreflightCatalogue): PreflightRouting {
  if (labels.wantsHuman) {
    const known = labels.desk !== NONE && catalogue.desks.some((d) => d.id === labels.desk);
    return { kind: "escalation", deskId: known ? labels.desk : null };
  }
  if (labels.faq !== NONE) return { kind: "faq", faqId: labels.faq };
  if (labels.flow === FLOW_OTHER) return { kind: "fallback", reason: "other" };
  if (labels.flow === FLOW_DEFAULT) return { kind: "knowledge_search" };
  return { kind: "flow", flowId: labels.flow };
}

/** The message's language for the three-quarters count: `mixed` and `other` are neither. */
export function goldLanguage(labels: PreflightGoldLabels): PreflightLanguage | null {
  return (PREFLIGHT_LANGUAGES as readonly string[]).includes(labels.language)
    ? (labels.language as PreflightLanguage)
    : null;
}

type Level = 0 | 1 | 2 | 3;
type Reasoning = 0 | 1 | 2;

interface Spec {
  row: number;
  flags: string;
  intent: string;
  lang: PreflightGoldLanguage;
  message: string;
  flow: string;
  faq?: string;
  human?: boolean;
  desk?: string;
  reasoning?: Reasoning;
  frustration?: Level;
  augmented?: string;
}

let sequence = 0;
function c(spec: Spec): PreflightGoldCase {
  sequence += 1;
  return {
    id: `syn-${String(sequence).padStart(3, "0")}`,
    message: spec.message,
    source: {
      dataset: "bitext-customer-support-27k",
      row: spec.row,
      intent: spec.intent,
      flags: spec.flags,
      ...(spec.augmented ? { augmented: spec.augmented } : {}),
    },
    labels: {
      flow: spec.flow,
      faq: spec.faq ?? NONE,
      wantsHuman: spec.human ?? false,
      desk: spec.desk ?? NONE,
      reasoning: REASONING_LEVELS[spec.reasoning ?? 0],
      frustration: spec.frustration ?? 0,
      language: spec.lang,
    },
    provenance: "synthetic",
  };
}

const D = FLOW_DEFAULT;
const O = FLOW_OTHER;
const TOPIC = "topic clause added so the desk question has a positive case";
const JUDGMENT = "rewritten as a judgment question; the corpus has none";

export const PREFLIGHT_SYNTHETIC_CASES: readonly PreflightGoldCase[] = [
  // ── contact_human_agent ────────────────────────────────────────────────────
  c({ row: 9075, flags: "BELZ", intent: "contact_human_agent", lang: "it",
    message: "Non so cosa devo fare per parlare con un operatore in carne e ossa",
    flow: O, human: true }),
  c({ row: 9698, flags: "BILPQZ", intent: "contact_human_agent", lang: "it",
    message: "potresti aiutarmi a parlre con qualcuno?",
    flow: O, human: true }),
  c({ row: 9360, flags: "BLZ", intent: "contact_human_agent", lang: "it",
    message: "passami un assistnte",
    flow: O, human: true, frustration: 1 }),
  c({ row: 9175, flags: "BLZ", intent: "contact_human_agent", lang: "en",
    message: "I need help to speak to someond",
    flow: O, human: true }),
  c({ row: 9563, flags: "BCILQZ", intent: "contact_human_agent", lang: "it",
    message: "non mi stai aiutando per niente, come faccio a chattare con un agente",
    flow: O, human: true, frustration: 2 }),
  c({ row: 9649, flags: "BLZ", intent: "contact_human_agent", lang: "it",
    message: "non so come fare a parlare con un operatoer vero, il pagamento non va",
    flow: "payment_issue", human: true, desk: "desk_billing", frustration: 1, augmented: TOPIC }),
  c({ row: 9232, flags: "BLQZ", intent: "contact_human_agent", lang: "it",
    message: "vorrei parlare con un assitente per un problema con il mio ordine",
    flow: O, human: true, desk: "desk_orders", augmented: TOPIC }),
  c({ row: 9393, flags: "BL", intent: "contact_human_agent", lang: "en",
    message: "help me speak to a live agent",
    flow: O, human: true }),
  c({ row: 9114, flags: "BL", intent: "contact_human_agent", lang: "it",
    message: "Ho bisogno di parlare con una persona, non con un bot",
    flow: O, human: true, frustration: 1 }),
  c({ row: 9042, flags: "BL", intent: "contact_human_agent", lang: "it",
    message: "aiutami a parlare con un operatore, non riesco ad accedere al mio account",
    flow: "account_access", human: true, desk: "desk_account", frustration: 1, augmented: TOPIC }),
  c({ row: 9454, flags: "BL", intent: "contact_human_agent", lang: "it",
    message: "chat con operatore umano",
    flow: O, human: true }),
  c({ row: 9763, flags: "BEL", intent: "contact_human_agent", lang: "en",
    message: "I do not know what I have to do to speak to a live agent about my refund",
    flow: "refunds", human: true, desk: "desk_billing", augmented: TOPIC }),
  c({ row: 9883, flags: "BL", intent: "contact_human_agent", lang: "it",
    message: "Devo contattare un assistente per una fattura sbagliata",
    flow: O, human: true, desk: "desk_billing", frustration: 1, augmented: TOPIC }),
  c({ row: 9293, flags: "BL", intent: "contact_human_agent", lang: LANGUAGE_MIXED,
    message: "Non so come fare to contact a person, help",
    flow: O, human: true }),
  // ── contact_customer_service ───────────────────────────────────────────────
  c({ row: 8690, flags: "BCLW", intent: "contact_customer_service", lang: "it",
    message: "voglio parlare con il cazzo di servizio clienti, aiutami",
    flow: O, human: true, frustration: 3 }),
  c({ row: 8594, flags: "BLQZ", intent: "contact_customer_service", lang: "it",
    message: "vorrei sapere a che ora posso chiamre il servizio clienti",
    flow: D, faq: "faq_contact_hours" }),
  c({ row: 8189, flags: "BLW", intent: "contact_customer_service", lang: "en",
    message: "I want to call the damn customer service",
    flow: O, human: true, frustration: 2 }),
  c({ row: 8814, flags: "BILZ", intent: "contact_customer_service", lang: "it",
    message: "cosa devo fare per parlare con l'assistenza clineti?",
    flow: O, human: true }),
  c({ row: 8357, flags: "BLQ", intent: "contact_customer_service", lang: "it",
    message: "devo vedere a che ora è disponibile l'assistenza clienti",
    flow: D, faq: "faq_contact_hours" }),
  c({ row: 8774, flags: "BILQ", intent: "contact_customer_service", lang: "en",
    message: "where do I check what hours I can call customer service?",
    flow: D, faq: "faq_contact_hours" }),
  c({ row: 8130, flags: "BL", intent: "contact_customer_service", lang: "it",
    message: "dimmi a che ora è disponibile il servizio clienti",
    flow: D, faq: "faq_contact_hours" }),
  c({ row: 8828, flags: "BIL", intent: "contact_customer_service", lang: "it",
    message: "come si fa a parlare con il servizio clienti?",
    flow: O, human: true }),
  // ── complaint ──────────────────────────────────────────────────────────────
  c({ row: 7574, flags: "BCLQZ", intent: "complaint", lang: "it",
    message: "devo fare un reclmo, mi serve aiuto",
    flow: "complaint", frustration: 2 }),
  c({ row: 7115, flags: "BILZ", intent: "complaint", lang: "it",
    message: "posso presentare un reclmo formale contro la vostra azienda?",
    flow: "complaint", frustration: 2 }),
  c({ row: 7282, flags: "BLQZ", intent: "complaint", lang: "en",
    message: "i need assistance making a consumer claim against ur compan",
    flow: "complaint", frustration: 2 }),
  c({ row: 6961, flags: "BLQZ", intent: "complaint", lang: "it",
    message: "mi serve aiuto per fare un reclamo contro la vs azienda",
    flow: "complaint", frustration: 2 }),
  c({ row: 7302, flags: "BLQZ", intent: "complaint", lang: "it",
    message: "aiutami a fare un reclamo contro la vostra azienda",
    flow: "complaint", frustration: 2 }),
  c({ row: 7527, flags: "BL", intent: "complaint", lang: "en",
    message: "I need to file a customer complaint against your company",
    flow: "complaint", frustration: 2 }),
  c({ row: 7548, flags: "BIL", intent: "complaint", lang: "it",
    message: "potete aiutarmi a presentare un reclamo?",
    flow: "complaint", frustration: 1 }),
  c({ row: 7879, flags: "BL", intent: "complaint", lang: "it",
    message: "Devo fare un reclamo",
    flow: "complaint", frustration: 2 }),
  c({ row: 7865, flags: "BL", intent: "complaint", lang: "it",
    message: "aiutatemi a fare un reclamo, voglio parlare con un responsabile",
    flow: "complaint", human: true, frustration: 2, augmented: "asks for a manager, so a complaint also escalates" }),
  c({ row: 6917, flags: "BILQ", intent: "complaint", lang: "en",
    message: "where can I file a complaint against your company",
    flow: "complaint", frustration: 2 }),
  // ── recover_password ───────────────────────────────────────────────────────
  c({ row: 20317, flags: "BLW", intent: "recover_password", lang: "it",
    message: "voglio recuperare la mia maledetta password",
    flow: "account_access", faq: "faq_password", frustration: 2 }),
  c({ row: 19944, flags: "BLW", intent: "recover_password", lang: "en",
    message: "help restoring my damn account password",
    flow: "account_access", faq: "faq_password", frustration: 2 }),
  c({ row: 19963, flags: "BLQZ", intent: "recover_password", lang: "it",
    message: "mi serve aiuot per recuperare il PIN del mio profilo",
    flow: "account_access", faq: "faq_password" }),
  c({ row: 20754, flags: "BELNQZ", intent: "recover_password", lang: "it",
    message: "non riesco a recuperare la pasword del mio profilo",
    flow: "account_access", frustration: 1 }),
  c({ row: 20246, flags: "BELQZ", intent: "recover_password", lang: "en",
    message: "I do not know how I can restore the pasword of my account",
    flow: "account_access", faq: "faq_password" }),
  c({ row: 20191, flags: "BLQ", intent: "recover_password", lang: "it",
    message: "mi serve assistenza per reimpostare il codice PIN del mio account",
    flow: "account_access", faq: "faq_password" }),
  c({ row: 19900, flags: "BEL", intent: "recover_password", lang: "it",
    message: "non so cosa fare per recuperare il PIN del mio utente",
    flow: "account_access", faq: "faq_password" }),
  c({ row: 20270, flags: "BLQ", intent: "recover_password", lang: "it",
    message: "info sul recupero password",
    flow: "account_access", faq: "faq_password" }),
  c({ row: 20546, flags: "BCL", intent: "recover_password", lang: "en",
    message: "I lost my account PIN, I want help restoring it",
    flow: "account_access", faq: "faq_password" }),
  c({ row: 20391, flags: "BLQ", intent: "recover_password", lang: "it",
    message: "ho bisogno di recuperare la password del mio utente",
    flow: "account_access", faq: "faq_password" }),
  // ── registration_problems ──────────────────────────────────────────────────
  c({ row: 21352, flags: "BCIMQZ", intent: "registration_problems", lang: "it",
    message: "ho dei problemi a registrarmi, come si fa?",
    flow: "account_access", reasoning: 1, frustration: 1 }),
  c({ row: 21197, flags: "BLZ", intent: "registration_problems", lang: "it",
    message: "aiuto per segnalare un problema con la registrzione",
    flow: "account_access", frustration: 1 }),
  c({ row: 21835, flags: "BILQZ", intent: "registration_problems", lang: "en",
    message: "how do I report a sign-up eror",
    flow: "account_access", frustration: 1 }),
  c({ row: 20911, flags: "BLMQWZ", intent: "registration_problems", lang: "it",
    message: "non so come cavolo segnalare i problemi di registrazione",
    flow: "account_access", frustration: 2 }),
  c({ row: 20921, flags: "BKL", intent: "registration_problems", lang: "it",
    message: "segnalazione problema registrazione",
    flow: "account_access", frustration: 1 }),
  c({ row: 21137, flags: "BL", intent: "registration_problems", lang: "en",
    message: "I am trying to report an issue with registration",
    flow: "account_access", frustration: 1 }),
  c({ row: 20930, flags: "BELQ", intent: "registration_problems", lang: "it",
    message: "Sto riscontrando un problema con la registrazione online",
    flow: "account_access", frustration: 1 }),
  c({ row: 21431, flags: "BCELN", intent: "registration_problems", lang: "it",
    message: "Non riesco a registrarmi, segnalo un problema di iscrizione",
    flow: "account_access", frustration: 1 }),
  // ── get_refund ─────────────────────────────────────────────────────────────
  c({ row: 16085, flags: "BKMZ", intent: "get_refund", lang: "it",
    message: "rimborso 45 euro",
    flow: "refunds" }),
  c({ row: 16569, flags: "BLMW", intent: "get_refund", lang: "it",
    message: "voglio il mio cazzo di rimborso",
    flow: "refunds", frustration: 3 }),
  c({ row: 16774, flags: "BKLMZ", intent: "get_refund", lang: "en",
    message: "refund €120",
    flow: "refunds" }),
  c({ row: 16198, flags: "BKLMZ", intent: "get_refund", lang: "it",
    message: "rimborsare 89,90 €",
    flow: "refunds" }),
  c({ row: 16459, flags: "BELQZ", intent: "get_refund", lang: "it",
    message: "non so come ottenere un rimborso",
    flow: "refunds", reasoning: 1 }),
  c({ row: 16072, flags: "BL", intent: "get_refund", lang: "it",
    message: "Ho bisogno di aiuto per chiedere la restituzione dei soldi",
    flow: "refunds", reasoning: 1 }),
  c({ row: 16794, flags: "BLP", intent: "get_refund", lang: "en",
    message: "I don't know how I could request my money back",
    flow: "refunds", reasoning: 1 }),
  c({ row: 16709, flags: "BIL", intent: "get_refund", lang: "it",
    message: "quando mi arriva il rimborso?",
    flow: "refunds", frustration: 1 }),
  c({ row: 16044, flags: "BLMQ", intent: "get_refund", lang: "it",
    message: "non so come chiedere il rimborso dei soldi",
    flow: "refunds", reasoning: 1 }),
  c({ row: 16334, flags: "BLMQ", intent: "get_refund", lang: LANGUAGE_MIXED,
    message: "need help per ricevere il rimborso dei miei soldi",
    flow: "refunds", reasoning: 1 }),
  // ── track_refund ───────────────────────────────────────────────────────────
  c({ row: 26298, flags: "BZ", intent: "track_refund", lang: "it",
    message: "Sto aspettando un rimborso di 45 euro",
    flow: "refunds", frustration: 1 }),
  c({ row: 26337, flags: "BLZ", intent: "track_refund", lang: "it",
    message: "Mi aspetto la restituzione di 120 euro",
    flow: "refunds", frustration: 1 }),
  c({ row: 26684, flags: "BLZ", intent: "track_refund", lang: "en",
    message: "I expect a compendation of €60",
    flow: "refunds", frustration: 1 }),
  c({ row: 26536, flags: "BLNQ", intent: "track_refund", lang: "it",
    message: "non riesco a vedere lo stato del mio rimborso",
    flow: "refunds", frustration: 1 }),
  c({ row: 26540, flags: "BLQ", intent: "track_refund", lang: "it",
    message: "sto aspettando un rimborso di 200 euro, è passato un mese",
    flow: "refunds", frustration: 2, augmented: "elapsed time added for a clearly frustrated refund case" }),
  c({ row: 26561, flags: "BL", intent: "track_refund", lang: "en",
    message: "I am waiting for a rebate of €35",
    flow: "refunds", frustration: 1 }),
  // ── check_refund_policy ────────────────────────────────────────────────────
  c({ row: 6056, flags: "BLQZ", intent: "check_refund_policy", lang: "it",
    message: "voglio sapere in quali casi posso chidere un rimborso",
    flow: "refunds", faq: "faq_refund_policy", reasoning: 1 }),
  c({ row: 6498, flags: "BZ", intent: "check_refund_policy", lang: "it",
    message: "vorrei sapere quanto tempo ci vuole di solito per un rimborso",
    flow: "refunds" }),
  c({ row: 6501, flags: "BILQWZ", intent: "check_refund_policy", lang: "en",
    message: "how do I check ur goddamn money back guarantee",
    flow: "refunds", faq: "faq_refund_policy", reasoning: 1, frustration: 2 }),
  c({ row: 6601, flags: "BLQZ", intent: "check_refund_policy", lang: "it",
    message: "vorrei vedere la vostra politica di rimbroso",
    flow: "refunds", faq: "faq_refund_policy", reasoning: 1 }),
  c({ row: 6695, flags: "BCL", intent: "check_refund_policy", lang: "it",
    message: "devo vedere la vostra garanzia soddisfatti o rimborsati, aiutami",
    flow: "refunds", faq: "faq_refund_policy", reasoning: 1 }),
  c({ row: 6810, flags: "BL", intent: "check_refund_policy", lang: "en",
    message: "I need assistance to check your reimbursement policy",
    flow: "refunds", faq: "faq_refund_policy", reasoning: 1 }),
  c({ row: 6277, flags: "BLP", intent: "check_refund_policy", lang: "it",
    message: "Vorrei sapere in quali casi posso richiedere un rimborso",
    flow: "refunds", faq: "faq_refund_policy", reasoning: 1 }),
  c({ row: 6110, flags: "BL", intent: "check_refund_policy", lang: "it",
    message: "ho ricevuto un prodotto diverso da quello ordinato: mi conviene chiedere il rimborso o la sostituzione?",
    flow: "refunds", reasoning: 2, frustration: 1, augmented: JUDGMENT }),
  // ── check_cancellation_fee ─────────────────────────────────────────────────
  c({ row: 3445, flags: "BLW", intent: "check_cancellation_fee", lang: "it",
    message: "fammi vedere la maledetta penale di recesso",
    flow: D, faq: "faq_cancellation_fee", frustration: 2 }),
  c({ row: 3706, flags: "BIMQZ", intent: "check_cancellation_fee", lang: "it",
    message: "mi fai vedere le penlai di annullamento?",
    flow: D, faq: "faq_cancellation_fee" }),
  c({ row: 3344, flags: "BLMQ", intent: "check_cancellation_fee", lang: "it",
    message: "vorrei vedere le penali di recesso",
    flow: D, faq: "faq_cancellation_fee" }),
  c({ row: 3491, flags: "BLQ", intent: "check_cancellation_fee", lang: "it",
    message: "voglio sapere quanto costa la penale se disdico in anticipo",
    flow: D, faq: "faq_cancellation_fee" }),
  // ── cancel_order ───────────────────────────────────────────────────────────
  c({ row: 690, flags: "BCZ", intent: "cancel_order", lang: "it",
    message: "ho comprato una cosa, aiutami ad annullare l'acqusto 48213",
    flow: "order_changes" }),
  c({ row: 845, flags: "BLZ", intent: "cancel_order", lang: "it",
    message: "sto cercando di annullare l'ordien 77120",
    flow: "order_changes", frustration: 1 }),
  c({ row: 679, flags: "BLZ", intent: "cancel_order", lang: "en",
    message: "I need help with cancelling purhase 55019",
    flow: "order_changes" }),
  c({ row: 948, flags: "BQZ", intent: "cancel_order", lang: "it",
    message: "mi serve aiuto per canellare l'ordine 30988",
    flow: "order_changes" }),
  c({ row: 700, flags: "BIL", intent: "cancel_order", lang: "it",
    message: "potete aiutarmi ad annullare l'ordine 61402?",
    flow: "order_changes" }),
  c({ row: 681, flags: "BILP", intent: "cancel_order", lang: "en",
    message: "how could I cancel order 18837?",
    flow: "order_changes" }),
  c({ row: 500, flags: "B", intent: "cancel_order", lang: "it",
    message: "problema con l'annullamento dell'ordine 90211",
    flow: "order_changes", frustration: 1 }),
  c({ row: 133, flags: "BL", intent: "cancel_order", lang: "it",
    message: "l'ordine 24680 non è ancora partito: mi conviene annullarlo e rifarlo con l'indirizzo giusto o modificarlo?",
    flow: "order_changes", reasoning: 2, augmented: JUDGMENT }),
  // ── change_order ───────────────────────────────────────────────────────────
  c({ row: 1581, flags: "BELNZ", intent: "change_order", lang: "it",
    message: "non riesco a togliere un articolo dall'ordne 48213",
    flow: "order_changes", frustration: 1 }),
  c({ row: 1598, flags: "BKLZ", intent: "change_order", lang: "it",
    message: "modificare ordien 55019",
    flow: "order_changes" }),
  c({ row: 1766, flags: "BLNQZ", intent: "change_order", lang: "en",
    message: "i cant delete a prodcut from order 77120",
    flow: "order_changes", frustration: 1 }),
  c({ row: 1302, flags: "BLQ", intent: "change_order", lang: "it",
    message: "mi serve aiuto per sostituire un prodotto dell'ordine 30988",
    flow: "order_changes", reasoning: 1 }),
  c({ row: 1280, flags: "BCLMQ", intent: "change_order", lang: "it",
    message: "vorrei cambiare alcuni articoli dell'ordine 61402, mi aiuti?",
    flow: "order_changes", reasoning: 1 }),
  c({ row: 1488, flags: "BIL", intent: "change_order", lang: "en",
    message: "how can I switch an item of order 18837?",
    flow: "order_changes", reasoning: 1 }),
  // ── change_shipping_address ────────────────────────────────────────────────
  c({ row: 2581, flags: "BLQZ", intent: "change_shipping_address", lang: "it",
    message: "mi serve supporto, sto cercnado di cambiare l'indirizzo",
    flow: "order_changes", frustration: 1 }),
  c({ row: 2087, flags: "BLZ", intent: "change_shipping_address", lang: "it",
    message: "c'è un problema quando provo a cambiare l'indirizzo di consgena",
    flow: "order_changes", frustration: 1 }),
  c({ row: 2699, flags: "BLZ", intent: "change_shipping_address", lang: "en",
    message: "help to edit the delivery aderess",
    flow: "order_changes" }),
  c({ row: 2322, flags: "BL", intent: "change_shipping_address", lang: "it",
    message: "Ho un problema a modificare il mio indirizzo",
    flow: "order_changes", frustration: 1 }),
  c({ row: 2295, flags: "BLM", intent: "change_shipping_address", lang: "it",
    message: "ci sono problemi a modificare l'indirizzo di spedizione, ho già provato tre volte",
    flow: "order_changes", frustration: 2, augmented: "repetition added for a clearly frustrated order case" }),
  c({ row: 2660, flags: "BL", intent: "change_shipping_address", lang: "en",
    message: "help with an address modification",
    flow: "order_changes" }),
  // ── set_up_shipping_address ────────────────────────────────────────────────
  c({ row: 23701, flags: "BLQW", intent: "set_up_shipping_address", lang: "it",
    message: "voglio inserire questo maledetto indirizzo di consegna",
    flow: "order_changes", frustration: 2 }),
  c({ row: 23547, flags: "BLZ", intent: "set_up_shipping_address", lang: "it",
    message: "c'è un problema nell'inserire un secondo indirzzo di consegna",
    flow: "order_changes", frustration: 1 }),
  c({ row: 23407, flags: "BL", intent: "set_up_shipping_address", lang: "it",
    message: "c'è un problema nell'inserire il mio secondo indirizzo di consegna",
    flow: "order_changes", frustration: 1 }),
  // ── track_order ────────────────────────────────────────────────────────────
  c({ row: 25712, flags: "BLZ", intent: "track_order", lang: "it",
    message: "assitenza per tracciare l'ordine 48213",
    flow: D, faq: "faq_track_order" }),
  c({ row: 24943, flags: "BKZ", intent: "track_order", lang: "it",
    message: "tracciaordine 77120",
    flow: D, faq: "faq_track_order" }),
  c({ row: 25206, flags: "BCILPQZ", intent: "track_order", lang: "en",
    message: "ned to locate order 55019, how could I do it?",
    flow: D, faq: "faq_track_order" }),
  c({ row: 25234, flags: "BIQZ", intent: "track_order", lang: "it",
    message: "come posso seguier l'ordine 30988",
    flow: D, faq: "faq_track_order" }),
  c({ row: 25708, flags: "BLQ", intent: "track_order", lang: "it",
    message: "voglio sapere dov'è il mio ordine 61402",
    flow: D, faq: "faq_track_order" }),
  c({ row: 25289, flags: "BKL", intent: "track_order", lang: "it",
    message: "dove è l'ordine 18837",
    flow: D, faq: "faq_track_order" }),
  c({ row: 25076, flags: "BL", intent: "track_order", lang: "en",
    message: "I want to see the ETA of order 90211",
    flow: D, faq: "faq_track_order" }),
  c({ row: 25291, flags: "BILQ", intent: "track_order", lang: "it",
    message: "dove vedo lo stato attuale dell'ordine 24680?",
    flow: D, faq: "faq_track_order" }),
  // ── delivery_period ────────────────────────────────────────────────────────
  c({ row: 12934, flags: "BILW", intent: "delivery_period", lang: "it",
    message: "come faccio a vedere quando arriva questo benedetto pacco?",
    flow: D, faq: "faq_track_order", frustration: 2 }),
  c({ row: 13504, flags: "BLQZ", intent: "delivery_period", lang: "it",
    message: "vorrei sapere in quanto tempo arriva di solito un pacoc",
    flow: D, faq: "faq_delivery_time" }),
  c({ row: 13599, flags: "BLQWZ", intent: "delivery_period", lang: "en",
    message: "help me see how soon I can expect the goddamn oredr",
    flow: D, faq: "faq_track_order", frustration: 2 }),
  c({ row: 13696, flags: "BL", intent: "delivery_period", lang: "it",
    message: "sto cercando di capire quanto ci vuole ad arrivare il pacco",
    flow: D, faq: "faq_delivery_time" }),
  c({ row: 13749, flags: "BCIL", intent: "delivery_period", lang: "it",
    message: "quanto tempo ci mette la spedizione? mi aiuti?",
    flow: D, faq: "faq_delivery_time" }),
  c({ row: 13160, flags: "BIQ", intent: "delivery_period", lang: "en",
    message: "can u help me check when my item will arrive",
    flow: D, faq: "faq_track_order" }),
  // ── delivery_options ───────────────────────────────────────────────────────
  c({ row: 12691, flags: "BISZ", intent: "delivery_options", lang: "it",
    message: "poss ordinare da Lugano?",
    flow: D, faq: "faq_delivery_countries" }),
  c({ row: 12105, flags: "BIQSZ", intent: "delivery_options", lang: "it",
    message: "posso ordinare dalla Svizzzera",
    flow: D, faq: "faq_delivery_countries" }),
  c({ row: 12284, flags: "BIQS", intent: "delivery_options", lang: "en",
    message: "can I place an order from Ireland",
    flow: D, faq: "faq_delivery_countries" }),
  c({ row: 12160, flags: "BIS", intent: "delivery_options", lang: "it",
    message: "abito a Bolzano ma lavoro a Innsbruck: conviene farmi spedire in Italia o in Austria per la dogana?",
    flow: D, reasoning: 2, augmented: JUDGMENT }),
  // ── check_payment_methods ──────────────────────────────────────────────────
  c({ row: 5575, flags: "BLZ", intent: "check_payment_methods", lang: "it",
    message: "fammi vedere i metodi di pagmento accettati",
    flow: D, faq: "faq_payment_methods" }),
  c({ row: 5315, flags: "BILZ", intent: "check_payment_methods", lang: "it",
    message: "mi aiutate a capire qauli pagamenti accettate?",
    flow: D, faq: "faq_payment_methods" }),
  c({ row: 5450, flags: "BLW", intent: "check_payment_methods", lang: "en",
    message: "I have got to check the fucking accepted payment methods",
    flow: D, faq: "faq_payment_methods", frustration: 3 }),
  c({ row: 5298, flags: "BL", intent: "check_payment_methods", lang: "it",
    message: "Vorrei sapere quali metodi di pagamento accettate",
    flow: D, faq: "faq_payment_methods" }),
  c({ row: 5688, flags: "BL", intent: "check_payment_methods", lang: "it",
    message: "devo controllare i metodi di pagamento disponibili",
    flow: D, faq: "faq_payment_methods" }),
  // ── payment_issue ──────────────────────────────────────────────────────────
  c({ row: 18823, flags: "BLMQZ", intent: "payment_issue", lang: "it",
    message: "mi serve aiuto per segnalare problemi con i pagamneti",
    flow: "payment_issue", frustration: 1 }),
  c({ row: 18416, flags: "BLMQZ", intent: "payment_issue", lang: "it",
    message: "voglio segnalare un problema con il pagamneto",
    flow: "payment_issue", frustration: 1 }),
  c({ row: 17991, flags: "BILMQZ", intent: "payment_issue", lang: "en",
    message: "where can I report problems with online paymeny",
    flow: "payment_issue", frustration: 1 }),
  c({ row: 17995, flags: "BLM", intent: "payment_issue", lang: "it",
    message: "Ho bisogno di aiuto per segnalare un problema con il pagamento online",
    flow: "payment_issue", frustration: 1 }),
  c({ row: 18101, flags: "BILM", intent: "payment_issue", lang: "it",
    message: "potete aiutarmi a segnalare dei problemi con i pagamenti?",
    flow: "payment_issue", frustration: 1 }),
  // ── check_invoice ──────────────────────────────────────────────────────────
  c({ row: 4372, flags: "BLZ", intent: "check_invoice", lang: "it",
    message: "vorrei dare un'occhiata alla fattura n. 85632",
    flow: D, faq: "faq_invoice" }),
  c({ row: 4127, flags: "BLQZ", intent: "check_invoice", lang: "it",
    message: "mi serve aiuto per trovaer la fattura n. 00108",
    flow: D, faq: "faq_invoice" }),
  c({ row: 4855, flags: "BIL", intent: "check_invoice", lang: "it",
    message: "posso cercare la fattura n. 00108?",
    flow: D, faq: "faq_invoice" }),
  // ── get_invoice ────────────────────────────────────────────────────────────
  c({ row: 14927, flags: "BLW", intent: "get_invoice", lang: "it",
    message: "non so come scaricare la mia maledetta fattura",
    flow: D, faq: "faq_invoice", frustration: 2 }),
  c({ row: 15453, flags: "BILMZ", intent: "get_invoice", lang: "it",
    message: "come scarico la fattrua di sei settimane fa?",
    flow: D, faq: "faq_invoice" }),
  c({ row: 15776, flags: "BELQZ", intent: "get_invoice", lang: "it",
    message: "non so come scaricaer la fattura n. 12588",
    flow: D, faq: "faq_invoice" }),
  c({ row: 15415, flags: "BLM", intent: "get_invoice", lang: "it",
    message: "Devo scaricare le mie fatture",
    flow: D, faq: "faq_invoice" }),
  c({ row: 15435, flags: "BCL", intent: "get_invoice", lang: "it",
    message: "devo scaricare la fattura 12588, mi serve una mano",
    flow: D, faq: "faq_invoice" }),
  // ── create_account ─────────────────────────────────────────────────────────
  c({ row: 10188, flags: "BELW", intent: "create_account", lang: "it",
    message: "non so come si apre un maledetto account gratuito",
    flow: D, reasoning: 1, frustration: 2 }),
  c({ row: 10415, flags: "BCEL", intent: "create_account", lang: "en",
    message: "I haven't signed up yet, help me create a premium account",
    flow: D, reasoning: 1 }),
  // ── delete_account ─────────────────────────────────────────────────────────
  c({ row: 11653, flags: "BLMQZ", intent: "delete_account", lang: "it",
    message: "ho problemi con la chiusura di un account premuim",
    flow: D, frustration: 1 }),
  c({ row: 11810, flags: "BL", intent: "delete_account", lang: "it",
    message: "problema con la chiusura di un account premium",
    flow: D, frustration: 1 }),
  // ── edit_account ───────────────────────────────────────────────────────────
  c({ row: 14010, flags: "BKLQZ", intent: "edit_account", lang: "it",
    message: "modifcare dati account standard",
    flow: D }),
  c({ row: 14283, flags: "BKLQ", intent: "edit_account", lang: "en",
    message: "I moved abroad, should I edit my account details or open a new account on the local site?",
    flow: D, reasoning: 2, augmented: JUDGMENT }),
  // ── switch_account ─────────────────────────────────────────────────────────
  c({ row: 24302, flags: "BILW", intent: "switch_account", lang: "it",
    message: "dove cavolo passo all'account premium?",
    flow: D, frustration: 2 }),
  c({ row: 24550, flags: "BI", intent: "switch_account", lang: "it",
    message: "mi conviene passare all'account premium se faccio due ordini al mese?",
    flow: D, reasoning: 2, augmented: JUDGMENT }),
  // ── newsletter_subscription ────────────────────────────────────────────────
  c({ row: 16999, flags: "BELZ", intent: "newsletter_subscription", lang: "it",
    message: "non riesco a disiscrivermi dalla vostra newsletetr",
    flow: D, frustration: 1 }),
  // ── place_order ────────────────────────────────────────────────────────────
  c({ row: 18927, flags: "BLMW", intent: "place_order", lang: "en",
    message: "I need help to buy some bloody products",
    flow: D, frustration: 2 }),
  c({ row: 18945, flags: "BI", intent: "place_order", lang: "it",
    message: "dove si compra?",
    flow: D }),
  // ── review ─────────────────────────────────────────────────────────────────
  c({ row: 22019, flags: "BILQZ", intent: "review", lang: "it",
    message: "avete un indirizzo dove mandare un feedbcak?",
    flow: D }),
  c({ row: 22165, flags: "BLQ", intent: "review", lang: LANGUAGE_MIXED,
    message: "vorrei lasciare a comment about your service, where?",
    flow: D }),
];
