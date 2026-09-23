import { describe, expect, it } from "vitest";
import { clearsThreshold } from "./decision";
import {
  FLOW_DEFAULT,
  FLOW_OTHER,
  LANGUAGE_MIXED,
  LANGUAGE_OTHER,
  NONE,
  PREFLIGHT_LANGUAGES,
  PREFLIGHT_QUESTION_IDS,
  PREFLIGHT_THRESHOLDS,
  THINKING_LINES,
  buildPreflightQuestions,
  foldPreflightSignals,
  frustrationLevel,
  preflightRouting,
  reasoningLevel,
  spokenLanguage,
  thinkingLine,
  thinkingOutcome,
  type PreflightDecision,
  type ThinkingOutcome,
} from "./preflight";
import {
  PREFLIGHT_FIXTURE_CATALOGUE,
  PREFLIGHT_LABELLED_CASES,
} from "./testing/preflight-fixtures";
import type { Flow } from "./types";

/**
 * The pre-flight question map and its derivations (#951). The labelled replay
 * at the bottom is the gate the ticket asks for: change a threshold or a
 * criterion id so that a labelled case no longer produces its expected
 * outcome, and this file fails `pnpm verify`.
 */

const OUTCOMES: readonly ThinkingOutcome[] = ["knowledge_search", "faq", "escalation"];

function decisionOf(caseId: string): PreflightDecision {
  const found = PREFLIGHT_LABELLED_CASES.find((c) => c.id === caseId);
  if (!found) throw new Error(`no labelled case ${caseId}`);
  return { answers: found.answers, confidence: found.confidence, calibrated: true };
}

describe("buildPreflightQuestions", () => {
  const map = buildPreflightQuestions(PREFLIGHT_FIXTURE_CATALOGUE);

  it("asks the seven questions, each with its explicit exit", () => {
    expect(Object.keys(map).sort()).toEqual([...PREFLIGHT_QUESTION_IDS].sort());
    expect(Object.keys(map.flow.criteria)).toEqual(["password_reset", "refund_policy", FLOW_DEFAULT, FLOW_OTHER]);
    expect(Object.keys(map.faq.criteria)).toEqual(["faq_hours", "faq_password", "faq_invoice", NONE]);
    expect(Object.keys(map.desk.criteria)).toEqual(["desk_it", "desk_admin", NONE]);
    expect(Object.keys(map.language.criteria)).toEqual([...PREFLIGHT_LANGUAGES, LANGUAGE_MIXED, LANGUAGE_OTHER]);
    expect(map.reasoning.criteria).toHaveLength(3);
    expect(map.frustration.criteria).toHaveLength(4);
  });

  it("names the languages the state may be written in, in every instruction that reads content", () => {
    for (const id of ["flow", "faq", "wants_human", "desk", "reasoning", "frustration"] as const) {
      expect(map[id].instructions).toMatch(/may be written in Italian, English/);
    }
  });

  it("carries Italian and English examples in the static criteria", () => {
    const text = [
      map.wants_human.criteria?.true,
      map.wants_human.criteria?.false,
      ...map.reasoning.criteria,
      ...map.frustration.criteria,
      map.flow.criteria[FLOW_DEFAULT],
    ].join(" ");
    expect(text).toMatch(/con chi posso parlare/);
    expect(text).toMatch(/can I talk to someone/);
    expect(text).toMatch(/quando scade/);
    expect(text).toMatch(/opening hours/);
  });

  it("describes a Flow by its matcher description and its conversation-context examples", () => {
    expect(map.flow.criteria.password_reset).toContain("cannot sign in");
    expect(map.flow.criteria.password_reset).toContain('Messages like: "non riesco ad accedere"');
    expect(map.flow.criteria.password_reset).toContain('Not messages like: "il sito è lento"');
  });

  it("narrows the language options to the Assistant's locales, ignoring unknown ones", () => {
    const narrowed = buildPreflightQuestions({ ...PREFLIGHT_FIXTURE_CATALOGUE, locales: ["it-IT", "en-GB", "xx"] });
    expect(Object.keys(narrowed.language.criteria)).toEqual(["it", "en", LANGUAGE_MIXED, LANGUAGE_OTHER]);
    expect(narrowed.flow.instructions).toMatch(/may be written in Italian, English;/);
  });

  it("refuses a catalogue over the option cap instead of building a question Jev would reject", () => {
    const faqs = Array.from({ length: 260 }, (_, i) => ({ id: `faq-${i}`, question: `Q${i}?` }));
    expect(() => buildPreflightQuestions({ ...PREFLIGHT_FIXTURE_CATALOGUE, faqs })).toThrow(RangeError);
  });
});

describe("PREFLIGHT_THRESHOLDS", () => {
  it("has a threshold beside every question, and none on the two Scores", () => {
    for (const id of PREFLIGHT_QUESTION_IDS) expect(typeof PREFLIGHT_THRESHOLDS[id]).toBe("number");
    expect(PREFLIGHT_THRESHOLDS.reasoning).toBe(0);
    expect(PREFLIGHT_THRESHOLDS.frustration).toBe(0);
  });
});

describe("preflightRouting", () => {
  it("never routes under the adapter: the pre-flight informs, today's classification decides (#946)", () => {
    const decision = { ...decisionOf("it-02"), calibrated: false };
    expect(preflightRouting(decision, PREFLIGHT_FIXTURE_CATALOGUE)).toEqual({ kind: "fallback", reason: "uncalibrated" });
  });

  it("escalation outranks a curated answer and a Flow", () => {
    const base = decisionOf("it-03"); // a confident FAQ hit
    const asking = { ...base, answers: { ...base.answers, wants_human: { type: "boolean" as const, probability: 0.9 } } };
    expect(preflightRouting(asking, PREFLIGHT_FIXTURE_CATALOGUE)).toEqual({ kind: "escalation", deskId: null });
  });

  it("an option the model names that code did not supply is not a choice", () => {
    const base = decisionOf("it-02");
    const phantom = {
      ...base,
      answers: { ...base.answers, flow: { ...base.answers.flow, choice: "flow-that-was-deleted" } },
    };
    expect(preflightRouting(phantom, PREFLIGHT_FIXTURE_CATALOGUE)).toEqual({ kind: "fallback", reason: "unknown_option" });
    const phantomFaq = {
      ...base,
      answers: { ...base.answers, faq: { type: "choice" as const, choice: "faq-gone", probabilities: { "faq-gone": 0.95 } } },
      confidence: { ...base.confidence, faq: 0.95 },
    };
    expect(preflightRouting(phantomFaq, PREFLIGHT_FIXTURE_CATALOGUE)).toEqual({ kind: "fallback", reason: "unknown_option" });
  });

  it("a confident desk that is not in the catalogue escalates without a desk", () => {
    const base = decisionOf("it-01");
    const gone = { ...base, answers: { ...base.answers, desk: { ...base.answers.desk, choice: "desk-gone" } } };
    expect(preflightRouting(gone, PREFLIGHT_FIXTURE_CATALOGUE)).toEqual({ kind: "escalation", deskId: null });
  });
});

describe("the Thinking-line table (#946)", () => {
  it("has a line for every outcome in every language the map speaks", () => {
    for (const language of PREFLIGHT_LANGUAGES) {
      for (const outcome of OUTCOMES) {
        expect(THINKING_LINES[language][outcome].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no Flow name can appear in a line: the line depends on outcome and language only", () => {
    // The proof is structural: `thinkingLine` takes no Flow and no catalogue,
    // so the table is the whole of what a Visitor can see. The check below is
    // `routingNarration`'s runtime filter, turned into a test over a hostile
    // catalogue whose names and ids are the very words the lines use.
    const hostile: Flow[] = [
      "Looking this up", "Sto cercando la risposta", "Connecting you with support",
      "I have an answer for that", "Ho una risposta per questo", "risposta", "answer",
    ].map((name, i) => ({ ...PREFLIGHT_FIXTURE_CATALOGUE.flows[0], id: `looking-this-up-${i}`, name }));
    const catalogue = { ...PREFLIGHT_FIXTURE_CATALOGUE, flows: hostile };
    for (const language of PREFLIGHT_LANGUAGES) {
      for (const outcome of OUTCOMES) {
        const line = thinkingLine(outcome, language, null);
        expect(line).toBe(THINKING_LINES[language][outcome]);
        // Ids never leak, whatever the names are.
        for (const f of catalogue.flows) expect(line.toLowerCase()).not.toContain(f.id);
      }
    }
    // A routed Flow with a hostile name earns only the table's line, or none.
    const routed = thinkingOutcome({ kind: "flow", flowId: hostile[0].id }, catalogue);
    expect(routed === null || OUTCOMES.includes(routed)).toBe(true);
    // And over a realistic catalogue, no line contains any Flow's name or id.
    for (const language of PREFLIGHT_LANGUAGES) {
      for (const outcome of OUTCOMES) {
        const line = thinkingLine(outcome, language, null).toLowerCase();
        for (const f of PREFLIGHT_FIXTURE_CATALOGUE.flows) {
          expect(line).not.toContain(f.id.toLowerCase());
          expect(line).not.toContain(f.name.toLowerCase());
        }
      }
    }
  });

  it("falls back to the chat locale, then to English, and ignores a region tag", () => {
    expect(thinkingLine("faq", "it", "en")).toBe(THINKING_LINES.it.faq);
    expect(thinkingLine("faq", null, "pt-BR")).toBe(THINKING_LINES.pt.faq);
    expect(thinkingLine("faq", null, "ja")).toBe(THINKING_LINES.en.faq);
    expect(thinkingLine("faq", null, undefined)).toBe(THINKING_LINES.en.faq);
  });

  it("a routed Flow earns the search line only when it searches knowledge", () => {
    expect(thinkingOutcome({ kind: "flow", flowId: "password_reset" }, PREFLIGHT_FIXTURE_CATALOGUE)).toBe("knowledge_search");
    expect(thinkingOutcome({ kind: "flow", flowId: "refund_policy" }, PREFLIGHT_FIXTURE_CATALOGUE)).toBeNull();
    expect(thinkingOutcome({ kind: "fallback", reason: "other" }, PREFLIGHT_FIXTURE_CATALOGUE)).toBeNull();
  });
});

describe("labelled replay (the gate)", () => {
  it("covers at least twenty Italian and twenty English cases, each labelling every question", () => {
    const byLanguage = new Map<string, number>();
    for (const c of PREFLIGHT_LABELLED_CASES) byLanguage.set(c.language, (byLanguage.get(c.language) ?? 0) + 1);
    expect(byLanguage.get("it")).toBeGreaterThanOrEqual(20);
    expect(byLanguage.get("en")).toBeGreaterThanOrEqual(20);
    for (const c of PREFLIGHT_LABELLED_CASES) {
      expect(Object.keys(c.answers).sort()).toEqual([...PREFLIGHT_QUESTION_IDS].sort());
    }
    expect(new Set(PREFLIGHT_LABELLED_CASES.map((c) => c.id)).size).toBe(PREFLIGHT_LABELLED_CASES.length);
  });

  it.each(PREFLIGHT_LABELLED_CASES.map((c) => [c.id, c] as const))(
    "%s produces its labelled outcome",
    (_id, labelled) => {
      const decision: PreflightDecision = {
        answers: labelled.answers,
        confidence: labelled.confidence,
        calibrated: true,
      };
      expect(preflightRouting(decision, PREFLIGHT_FIXTURE_CATALOGUE)).toEqual(labelled.expected.routing);
      expect(spokenLanguage(decision)).toBe(labelled.expected.language);
      expect(reasoningLevel(decision)).toBe(labelled.expected.reasoning);
      expect(frustrationLevel(decision)).toBe(labelled.expected.frustration);
      expect(
        clearsThreshold({
          answer: decision.answers.wants_human,
          confidence: undefined,
          threshold: PREFLIGHT_THRESHOLDS.wants_human,
          calibrated: true,
        })
      ).toBe(labelled.expected.wantsHuman);
    }
  );
});

/**
 * The fold from turns to a Conversation (#956). Three signals, three different
 * rules, and the differences are the whole reason this is a function rather
 * than three assignments in the turn.
 */
describe("foldPreflightSignals", () => {
  const record = (over: {
    language?: string;
    wantsHuman?: boolean;
    wantsHumanConfidence?: number;
    frustration?: number;
  }) => ({
    calibrated: true,
    answers: [
      ...(over.language === undefined
        ? []
        : [{ id: "language" as const, value: over.language, confidence: 0.99, fallback: false }]),
      ...(over.wantsHuman === undefined
        ? []
        : [
            {
              id: "wants_human" as const,
              value: over.wantsHuman,
              confidence: over.wantsHumanConfidence ?? 0.99,
              fallback: false,
            },
          ]),
      ...(over.frustration === undefined
        ? []
        : [{ id: "frustration" as const, value: over.frustration, confidence: 0.95, fallback: false }]),
    ],
  });

  it("takes the majority language, not the latest", () => {
    // One English word in an Italian conversation is not a change of language,
    // and "latest wins" would have said it was.
    let signals = foldPreflightSignals(undefined, record({ language: "it" }));
    signals = foldPreflightSignals(signals, record({ language: "it" }));
    signals = foldPreflightSignals(signals, record({ language: "en" }));
    expect(signals.spokenLanguage).toBe("it");
  });

  it("does not count `mixed` or `other` as a language", () => {
    let signals = foldPreflightSignals(undefined, record({ language: "it" }));
    signals = foldPreflightSignals(signals, record({ language: LANGUAGE_MIXED }));
    signals = foldPreflightSignals(signals, record({ language: LANGUAGE_OTHER }));
    expect(signals.spokenLanguage).toBe("it");
  });

  it("keeps escalation intent once it has been asked for", () => {
    // Somebody talked out of wanting a person still asked for one, and a card
    // about how often people want out must not lose them.
    let signals = foldPreflightSignals(undefined, record({ wantsHuman: true }));
    signals = foldPreflightSignals(signals, record({ wantsHuman: false }));
    expect(signals.escalationIntent).toBe(true);
  });

  it("does not record intent from an answer under the threshold", () => {
    const signals = foldPreflightSignals(
      undefined,
      record({
        wantsHuman: true,
        wantsHumanConfidence: PREFLIGHT_THRESHOLDS.wants_human - 0.1,
      })
    );
    // Read the same way the router reads it, so a card and a routing decision
    // never disagree about what "asked for a person" means.
    expect(signals.escalationIntent).toBe(false);
  });

  it("keeps the desk the latest turn opened the chip on, and only when it acted", () => {
    const shadow = { ...record({ wantsHuman: true }), wouldRoute: { kind: "escalation" as const, deskId: "desk_it" } };
    expect(foldPreflightSignals(undefined, shadow).recommendedHelpDeskId).toBeUndefined();

    const routed = { ...shadow, acted: true };
    let signals = foldPreflightSignals(undefined, routed);
    expect(signals.recommendedHelpDeskId).toBe("desk_it");
    // A later turn that recommended nothing clears it: the chip it named is no
    // longer the latest reply, so a later escalation is not judged against it.
    signals = foldPreflightSignals(signals, record({ wantsHuman: false }));
    expect(signals.recommendedHelpDeskId).toBeUndefined();
    // An escalation with no confident desk recommends none.
    signals = foldPreflightSignals(routed && foldPreflightSignals(undefined, routed), { ...record({ wantsHuman: true }), acted: true, wouldRoute: { kind: "escalation" as const, deskId: null } });
    expect(signals.recommendedHelpDeskId).toBeUndefined();
  });

  it("keeps only the last turn's frustration, because the card asks how it ended", () => {
    let signals = foldPreflightSignals(undefined, record({ frustration: 3 }));
    signals = foldPreflightSignals(signals, record({ frustration: 0 }));
    expect(signals.endedAtFrustration).toBe(0);
  });

  it("leaves a signal alone when the turn did not answer that question", () => {
    const first = foldPreflightSignals(undefined, record({ language: "it", frustration: 2 }));
    const second = foldPreflightSignals(first, record({ wantsHuman: false }));
    expect(second.spokenLanguage).toBe("it");
    expect(second.endedAtFrustration).toBe(2);
  });
});
