import { describe, expect, it } from "vitest";

import { FLOW_DEFAULT, FLOW_OTHER, LANGUAGE_MIXED, LANGUAGE_OTHER, NONE, PREFLIGHT_LANGUAGES, REASONING_LEVELS, buildPreflightQuestions } from "./preflight";
import {
  PREFLIGHT_SYNTHETIC_CASES,
  PREFLIGHT_SYNTHETIC_CATALOGUE,
  goldLanguage,
  goldRouting,
} from "./testing/preflight-synthetic-cases";
import { PREFLIGHT_DRIFT_BASELINE } from "./testing/preflight-drift-baseline";
import { PREFLIGHT_GOLD_SETS } from "./testing/preflight-gold";

/**
 * The synthetic set is data, so the test pins the properties the set claims
 * rather than any case: size and language mix (#953's "three quarters
 * Italian"), every label a real option of the catalogue, and a spread over the
 * levels wide enough that a threshold or criterion is measured on every
 * outcome, not on the easy ones alone.
 */
const catalogue = PREFLIGHT_SYNTHETIC_CATALOGUE;
const flowIds = new Set([...catalogue.flows.map((f) => f.id), FLOW_DEFAULT, FLOW_OTHER]);
const faqIds = new Set([...catalogue.faqs.map((f) => f.id), NONE]);
const deskIds = new Set([...catalogue.desks.map((d) => d.id), NONE]);
const languages = new Set<string>([...PREFLIGHT_LANGUAGES, LANGUAGE_MIXED, LANGUAGE_OTHER]);

const count = <T>(items: readonly T[], pick: (t: T) => boolean): number => items.filter(pick).length;

describe("the synthetic pre-flight set", () => {
  it("has 150 cases, three quarters of them Italian", () => {
    expect(PREFLIGHT_SYNTHETIC_CASES).toHaveLength(150);
    const italian = count(PREFLIGHT_SYNTHETIC_CASES, (c) => goldLanguage(c.labels) === "it");
    expect(italian).toBeGreaterThanOrEqual(112);
    expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => goldLanguage(c.labels) === "en")).toBeGreaterThanOrEqual(30);
    expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => c.labels.language === LANGUAGE_MIXED)).toBeGreaterThanOrEqual(2);
  });

  it("has unique ids and unique source rows, and is marked synthetic throughout", () => {
    expect(new Set(PREFLIGHT_SYNTHETIC_CASES.map((c) => c.id)).size).toBe(150);
    expect(new Set(PREFLIGHT_SYNTHETIC_CASES.map((c) => c.source.row)).size).toBe(150);
    for (const c of PREFLIGHT_SYNTHETIC_CASES) {
      expect(c.provenance).toBe("synthetic");
      expect(c.source.dataset).toBe("bitext-customer-support-27k");
      expect(c.message.trim().length).toBeGreaterThan(0);
      expect(c.message).not.toMatch(/\{\{.*\}\}/);
    }
  });

  it("covers all 27 source intents", () => {
    expect(new Set(PREFLIGHT_SYNTHETIC_CASES.map((c) => c.source.intent)).size).toBe(27);
  });

  it("labels only with options the catalogue offers", () => {
    for (const c of PREFLIGHT_SYNTHETIC_CASES) {
      expect(flowIds.has(c.labels.flow), `${c.id} flow ${c.labels.flow}`).toBe(true);
      expect(faqIds.has(c.labels.faq), `${c.id} faq ${c.labels.faq}`).toBe(true);
      expect(deskIds.has(c.labels.desk), `${c.id} desk ${c.labels.desk}`).toBe(true);
      expect(languages.has(c.labels.language), `${c.id} language ${c.labels.language}`).toBe(true);
      expect(REASONING_LEVELS).toContain(c.labels.reasoning);
      expect([0, 1, 2, 3]).toContain(c.labels.frustration);
      // A desk is only ever a label on a message that asked for a person.
      if (!c.labels.wantsHuman) expect(c.labels.desk, `${c.id} desk without wantsHuman`).toBe(NONE);
    }
  });

  it("spreads over every outcome and every level, so nothing is measured on the easy cases alone", () => {
    const routings = PREFLIGHT_SYNTHETIC_CASES.map((c) => goldRouting(c.labels, catalogue));
    expect(count(routings, (r) => r.kind === "escalation" && r.deskId !== null)).toBeGreaterThanOrEqual(5);
    expect(count(routings, (r) => r.kind === "escalation" && r.deskId === null)).toBeGreaterThanOrEqual(10);
    expect(count(routings, (r) => r.kind === "faq")).toBeGreaterThanOrEqual(30);
    expect(count(routings, (r) => r.kind === "flow")).toBeGreaterThanOrEqual(40);
    expect(count(routings, (r) => r.kind === "knowledge_search")).toBeGreaterThanOrEqual(10);
    // No "other" case that does not also ask for a person: the corpus has no
    // greetings, thanks or off-topic rows. The 43-case hand-labelled set covers
    // those, and real traffic will bring them; the count is pinned so the gap
    // is visible rather than assumed away.
    expect(count(routings, (r) => r.kind === "fallback")).toBe(0);
    for (const faq of catalogue.faqs) {
      expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => c.labels.faq === faq.id), faq.id).toBeGreaterThanOrEqual(3);
    }
    for (const flow of catalogue.flows) {
      expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => c.labels.flow === flow.id), flow.id).toBeGreaterThanOrEqual(5);
    }
    for (const level of REASONING_LEVELS) {
      expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => c.labels.reasoning === level), level).toBeGreaterThanOrEqual(5);
    }
    for (const level of [0, 1, 2]) {
      expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => c.labels.frustration === level), `frustration ${level}`).toBeGreaterThanOrEqual(10);
    }
    expect(count(PREFLIGHT_SYNTHETIC_CASES, (c) => c.labels.frustration === 3)).toBeGreaterThanOrEqual(3);
  });

  it("builds a question map from the catalogue the real model can be asked", () => {
    const map = buildPreflightQuestions(catalogue);
    expect(Object.keys(map.flow.criteria)).toEqual([...catalogue.flows.map((f) => f.id), FLOW_DEFAULT, FLOW_OTHER]);
    expect(Object.keys(map.faq.criteria)).toHaveLength(catalogue.faqs.length + 1);
    expect(Object.keys(map.desk.criteria)).toHaveLength(catalogue.desks.length + 1);
  });

  it("says how every augmented case departs from its source row", () => {
    const augmented = PREFLIGHT_SYNTHETIC_CASES.filter((c) => c.source.augmented);
    expect(augmented.length).toBeGreaterThanOrEqual(8);
    expect(augmented.length).toBeLessThanOrEqual(15);
    for (const c of augmented) expect(c.source.augmented!.length).toBeGreaterThan(10);
  });
});

describe("goldRouting", () => {
  const base = { flow: "refunds", faq: NONE, wantsHuman: false, desk: NONE, reasoning: "lookup" as const, frustration: 0 as const, language: "it" as const };

  it("follows the spec's precedence without reading any confidence", () => {
    expect(goldRouting({ ...base, wantsHuman: true, desk: "desk_billing", faq: "faq_invoice" }, catalogue)).toEqual({ kind: "escalation", deskId: "desk_billing" });
    expect(goldRouting({ ...base, wantsHuman: true }, catalogue)).toEqual({ kind: "escalation", deskId: null });
    expect(goldRouting({ ...base, faq: "faq_invoice" }, catalogue)).toEqual({ kind: "faq", faqId: "faq_invoice" });
    expect(goldRouting(base, catalogue)).toEqual({ kind: "flow", flowId: "refunds" });
    expect(goldRouting({ ...base, flow: FLOW_DEFAULT }, catalogue)).toEqual({ kind: "knowledge_search" });
    expect(goldRouting({ ...base, flow: FLOW_OTHER }, catalogue)).toEqual({ kind: "fallback", reason: "other" });
  });

  it("drops a desk the catalogue does not list", () => {
    expect(goldRouting({ ...base, wantsHuman: true, desk: "desk_gone" }, catalogue)).toEqual({ kind: "escalation", deskId: null });
  });
});

describe("the drift baseline", () => {
  it("names only cases the labelled sets contain, each once", () => {
    expect(PREFLIGHT_DRIFT_BASELINE.length).toBeGreaterThan(100);
    const keys = PREFLIGHT_DRIFT_BASELINE.map((b) => `${b.set}:${b.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of PREFLIGHT_DRIFT_BASELINE) {
      const set = PREFLIGHT_GOLD_SETS.find((s) => s.name === entry.set);
      expect(set?.cases.some((c) => c.id === entry.id), `${entry.set}:${entry.id}`).toBe(true);
    }
  });

  it("presents both labelled sets as one gold shape", () => {
    expect(PREFLIGHT_GOLD_SETS.map((s) => [s.name, s.cases.length])).toEqual([["labelled", 55], ["synthetic", 150]]);
    for (const set of PREFLIGHT_GOLD_SETS) {
      for (const c of set.cases) expect(() => goldRouting(c.labels, set.catalogue)).not.toThrow();
    }
  });
});
