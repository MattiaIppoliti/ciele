import { describe, expect, it } from "vitest";
import { basicInteractionFlow, isCourtesyOnly } from "./basic-interaction";
import type { Flow } from "./types";

/**
 * The deterministic courtesy tier (#566). Pure: no model, no database, no
 * clock beyond what the caller passes.
 *
 * Every case here is really one question — "would routing this to Basic
 * Interaction cost the Visitor an answer?" A false negative costs a second of
 * latency; a false positive costs the whole reply. The table is weighted
 * accordingly: the negative cases are the ones that matter.
 */

let nextId = 0;

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  nextId += 1;
  return {
    id: `flow-${nextId}`,
    assistantId: "assistant-1",
    name: `Flow ${nextId}`,
    description: "",
    builtIn: false,
    enabled: true,
    position: nextId,
    trigger: "message",
    triggerSettings: {},
    conditionLogic: "any",
    conditions: [],
    actions: ["custom_message"],
    actionSettings: {},
    customMessage: "",
    isDefault: false,
    ...overrides,
  };
}

function courtesyFlow(overrides: Partial<Flow> = {}): Flow {
  return makeFlow({
    name: "Basic Interaction",
    builtIn: true,
    position: -1,
    actions: ["basic_reply"],
    ...overrides,
  });
}

describe("isCourtesyOnly", () => {
  describe("courtesy", () => {
    it.each([
      "ciao",
      "Ciao!",
      "ciao ciao",
      "salve",
      "buongiorno",
      "buonasera",
      "grazie",
      "grazie mille",
      "grazie tante!",
      "arrivederci",
      "a presto",
      "ok grazie",
      "perfetto, grazie",
      "hi",
      "hi there",
      "hello",
      "hey",
      "good morning",
      "good evening",
      "thanks",
      "thank you",
      "thanks a lot",
      "thanks so much",
      "many thanks",
      "cheers",
      "bye",
      "goodbye",
      "see you",
      "ok thanks",
      "great, thank you!",
      "got it, thanks",
    ])("%s", (message) => {
      expect(isCourtesyOnly(message)).toBe(true);
    });
  });

  /**
   * The lexicon widening (#567). Per locale: the four courtesy shapes it has to
   * recognise, and at least one same-language message that only LOOKS courteous —
   * the proof that adding a language did not loosen the detector.
   */
  describe("courtesy across the widget's locales", () => {
    const LOCALES: Array<{
      locale: string;
      courtesy: string[];
      notCourtesy: string[];
    }> = [
      {
        // Each list covers all four shapes the detector recognises, in order:
        // greeting, thanks, farewell, acknowledgement.
        locale: "es",
        courtesy: [
          "hola",
          "buenos días",
          "muchas gracias",
          "adiós",
          "hasta luego",
          "vale, gracias",
          "perfecto",
        ],
        notCourtesy: ["hola, dónde está el aula", "gracias pero necesito el horario"],
      },
      {
        locale: "fr",
        courtesy: [
          "bonjour",
          "bonsoir",
          "merci beaucoup",
          "au revoir",
          "à bientôt",
          "parfait, merci",
          "super",
        ],
        notCourtesy: ["bonjour, où est la salle", "merci mais je cherche le programme"],
      },
      {
        locale: "de",
        courtesy: [
          "hallo",
          "guten morgen",
          "vielen dank",
          "tschüss",
          "auf wiedersehen",
          "perfekt, danke",
          "prima",
        ],
        notCourtesy: ["hallo, wo ist der hörsaal", "danke aber ich brauche den termin"],
      },
      {
        locale: "nl",
        courtesy: [
          "hoi",
          "goedemorgen",
          "bedankt",
          "dank je",
          "tot ziens",
          "prima, bedankt",
          "mooi",
        ],
        notCourtesy: ["hoi, waar is de zaal", "bedankt maar ik zoek het rooster"],
      },
      {
        locale: "pt",
        courtesy: [
          "olá",
          "bom dia",
          "obrigado",
          "muito obrigada",
          "até logo",
          "perfeito, obrigado",
          "ótimo",
        ],
        notCourtesy: ["olá, onde fica a sala", "obrigado mas preciso do horário"],
      },
    ];

    for (const { locale, courtesy, notCourtesy } of LOCALES) {
      describe(locale, () => {
        it.each(courtesy)("courtesy: %s", (message) => {
          expect(isCourtesyOnly(message)).toBe(true);
        });
        it.each(notCourtesy)("not courtesy: %s", (message) => {
          expect(isCourtesyOnly(message)).toBe(false);
        });
      });
    }

    it("never treats a bare affirmative as courtesy", () => {
      // Deliberately absent from every locale's list: after the assistant asks a
      // question, "yes" is the visitor's ANSWER. Keeping these out means the
      // last-turn guard is a second line of defence, not the only one.
      for (const yes of ["yes", "sí", "si", "oui", "ja", "sim", "sure"]) {
        expect(isCourtesyOnly(yes), yes).toBe(false);
      }
    });
  });

  describe("not courtesy — a question wearing a greeting", () => {
    it.each([
      // The case that started this: courtesy on the front, a real question behind.
      "ciao, quando è la scadenza?",
      "ciao quando e la scadenza",
      "hi, what are the opening hours",
      "hello — where do I find the syllabus",
      "thanks, but where is the exam room",
      "grazie, ma dove trovo il programma",
    ])("%s", (message) => {
      expect(isCourtesyOnly(message)).toBe(false);
    });
  });

  describe("not courtesy — the other rejections", () => {
    it("rejects anything carrying a question mark", () => {
      // Even a message made entirely of courtesy words: a question mark means
      // something is being asked, whatever the words are.
      expect(isCourtesyOnly("ciao?")).toBe(false);
      expect(isCourtesyOnly("thanks?")).toBe(false);
    });

    it("rejects a long message even if every word is courteous", () => {
      const padded = `thanks ${"thanks ".repeat(20)}`.trim();
      expect(isCourtesyOnly(padded)).toBe(false);
    });

    it("rejects a message with no courtesy word at all", () => {
      // All stopwords, nothing left after filtering — but nothing courteous
      // either. Without this clause "the" and "is it" would read as greetings.
      expect(isCourtesyOnly("the")).toBe(false);
      expect(isCourtesyOnly("is it")).toBe(false);
      expect(isCourtesyOnly("come")).toBe(false);
    });

    it("rejects an empty or whitespace-only message", () => {
      expect(isCourtesyOnly("")).toBe(false);
      expect(isCourtesyOnly("   ")).toBe(false);
    });

    it("rejects content words that merely look short", () => {
      expect(isCourtesyOnly("scadenza")).toBe(false);
      expect(isCourtesyOnly("parking")).toBe(false);
    });
  });

  describe("not courtesy — an answer to the assistant's own question", () => {
    it("rejects a bare acknowledgement after the assistant asked something", () => {
      // "ok" here means "yes, go ahead" — routing it to a greeting resets the
      // conversation the assistant just tried to advance.
      const history = [
        { role: "user" as const, text: "I need help with enrolment" },
        {
          role: "assistant" as const,
          text: "Which programme are you enrolling in?",
        },
      ];
      expect(isCourtesyOnly("ok", history)).toBe(false);
      expect(isCourtesyOnly("ok grazie", history)).toBe(false);
    });

    it("honours an explicit asked flag when the text cannot show it", () => {
      // A clarification is persisted as a `clarify` part with no text part, so the
      // flattened text is empty and the question mark is nowhere to be found. The
      // caller, which can see the parts, says so outright.
      const history = [
        { role: "assistant" as const, text: "", askedQuestion: true },
      ];
      expect(isCourtesyOnly("ok", history)).toBe(false);
      expect(isCourtesyOnly("ok grazie", history)).toBe(false);
    });

    it("still treats courtesy as courtesy after a plain answer", () => {
      const history = [
        { role: "user" as const, text: "when do lectures start" },
        { role: "assistant" as const, text: "Lectures start on 14 September." },
      ];
      expect(isCourtesyOnly("grazie mille", history)).toBe(true);
    });

    it("looks only at the LAST assistant turn", () => {
      const history = [
        { role: "assistant" as const, text: "Which campus do you mean?" },
        { role: "user" as const, text: "Rome" },
        { role: "assistant" as const, text: "The Rome campus opens at 08:00." },
      ];
      expect(isCourtesyOnly("thanks", history)).toBe(true);
    });
  });
});

describe("basicInteractionFlow", () => {
  it("returns the built-in courtesy flow for a courtesy message", () => {
    const flow = courtesyFlow();
    const fallback = makeFlow({ name: "Default behavior", isDefault: true });
    expect(basicInteractionFlow("ciao", [flow, fallback])).toBe(flow);
  });

  it("returns null for a message that is not courtesy", () => {
    const flow = courtesyFlow();
    const fallback = makeFlow({ name: "Default behavior", isDefault: true });
    expect(basicInteractionFlow("quando è la scadenza?", [flow, fallback])).toBeNull();
  });

  it("identifies the flow structurally, so renaming it changes nothing", () => {
    // The runtime must not depend on a name an admin is free to edit.
    const renamed = courtesyFlow({ name: "Saluti" });
    expect(basicInteractionFlow("ciao", [renamed])).toBe(renamed);
  });

  it("ignores a non-built-in flow that carries the action", () => {
    const impostor = courtesyFlow({ builtIn: false });
    expect(basicInteractionFlow("ciao", [impostor])).toBeNull();
  });

  it("returns null when the flow is disabled", () => {
    expect(basicInteractionFlow("ciao", [courtesyFlow({ enabled: false })])).toBeNull();
  });

  it("returns null when no such flow exists", () => {
    expect(basicInteractionFlow("ciao", [makeFlow()])).toBeNull();
  });

  it("yields to a higher-priority flow that keyword-matches the message", () => {
    // Flow priority stays authoritative: an admin's own greeting campaign at a
    // better position wins, and the turn classifies normally.
    const campaign = makeFlow({ name: "Ciao campagna", position: -5 });
    const flow = courtesyFlow();
    expect(basicInteractionFlow("ciao", [campaign, flow])).toBeNull();
  });

  it("does not yield to a higher-priority flow that does NOT match", () => {
    const unrelated = makeFlow({ name: "Refund requests", position: -5 });
    const flow = courtesyFlow();
    expect(basicInteractionFlow("ciao", [unrelated, flow])).toBe(flow);
  });

  it("does not yield to a LOWER-priority flow that matches", () => {
    const campaign = makeFlow({ name: "Ciao campagna", position: 9 });
    const flow = courtesyFlow();
    expect(basicInteractionFlow("ciao", [campaign, flow])).toBe(flow);
  });

  it("inherits the objective condition gate — an off-page URL condition disqualifies it", () => {
    const flow = courtesyFlow({
      conditions: [
        { id: "c1", kind: "url", operator: "contains", value: "/courses/" },
      ],
    });
    expect(
      basicInteractionFlow("ciao", [flow], { url: "https://x.test/about" })
    ).toBeNull();
    expect(
      basicInteractionFlow("ciao", [flow], { url: "https://x.test/courses/1" })
    ).toBe(flow);
  });

  it("never selects a proactively-triggered flow", () => {
    const flow = courtesyFlow({ trigger: "chat_open" });
    expect(basicInteractionFlow("ciao", [flow])).toBeNull();
  });

  it("passes history through to the detector", () => {
    const flow = courtesyFlow();
    const history = [
      { role: "assistant" as const, text: "Which programme do you mean?" },
    ];
    expect(basicInteractionFlow("ok", [flow], { history })).toBeNull();
    expect(basicInteractionFlow("ok", [flow])).toBe(flow);
  });
});
