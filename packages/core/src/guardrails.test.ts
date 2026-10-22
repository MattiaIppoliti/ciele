import { describe, expect, it } from "vitest";
import {
  GUARDRAIL_TYPES,
  createMarkerSuppressor,
  defaultGuardrail,
  deterministicViolation,
  guardrailListProblem,
  guardrailProblem,
  inputGuardrails,
  maskingGuardrail,
  orderGuardrails,
  streamGuardrails,
  suppressMarkedContent,
  type AssistantGuardrail,
  type InputGuardrail,
  type MaskingGuardrail,
  type StreamGuardrail,
} from "./guardrails";
import type { PiiDetector } from "./pii";

function rule(start: string, stop: string, message = "[removed]"): StreamGuardrail {
  return { ...(defaultGuardrail("sensitive_content_stream", start) as StreamGuardrail), startMarker: start, stopMarker: stop, message };
}

describe("defaultGuardrail + guardrailProblem", () => {
  it("names what an unconfigured default still needs", () => {
    const problems = Object.fromEntries(
      GUARDRAIL_TYPES.map((type) => [type, guardrailProblem(defaultGuardrail(type, type))])
    );
    // Length limit and moderation are usable as created; the rest need input.
    expect(problems.input_length_limit).toBeNull();
    expect(problems.moderation).toBeNull();
    expect(problems.regexp_guardrail).toBe("Write a pattern.");
    expect(problems.restrict_to_topic).toBe("Add at least one topic.");
    expect(problems.sensitive_content_stream).toBe("Set both markers.");
    // Masking needs no reply: it never answers the Visitor in place of a turn.
    expect(problems.pii_masking).toBeNull();
  });

  it("refuses a masking guardrail with no detector, an unknown one or a repeat", () => {
    const masking = defaultGuardrail("pii_masking", "p") as MaskingGuardrail;
    expect(guardrailProblem({ ...masking, detectors: [] })).toBe("Pick at least one kind of data to mask.");
    expect(guardrailProblem({ ...masking, detectors: ["passport" as PiiDetector] })).toBe(
      "Pick from the listed kinds of data."
    );
    expect(guardrailProblem({ ...masking, detectors: ["email", "email"] })).toBe("Pick each kind of data once.");
  });

  it("refuses a pattern that does not compile", () => {
    const g = { ...defaultGuardrail("regexp_guardrail", "r"), pattern: "(unclosed" } as AssistantGuardrail;
    expect(guardrailProblem(g)).toBe("The pattern is not a valid regular expression.");
  });

  it("allows one masking guardrail per assistant", () => {
    expect(
      guardrailListProblem([defaultGuardrail("pii_masking", "a"), defaultGuardrail("pii_masking", "b")])
    ).toBe("Use one PII masking guardrail per assistant.");
  });

  it("refuses duplicate ids and names the failing guardrail", () => {
    const a = defaultGuardrail("input_length_limit", "same");
    expect(guardrailListProblem([a, { ...a }])).toBe("Guardrail ids must be unique.");
    expect(guardrailListProblem([defaultGuardrail("regexp_guardrail", "r")])).toBe(
      "Regular expression: Write a pattern."
    );
  });
});

describe("orderGuardrails", () => {
  it("groups by type, cheap checks first, and keeps the order within a type", () => {
    const list: AssistantGuardrail[] = [
      defaultGuardrail("moderation", "m"),
      defaultGuardrail("regexp_guardrail", "r1"),
      defaultGuardrail("input_length_limit", "l"),
      defaultGuardrail("regexp_guardrail", "r2"),
    ];
    expect(orderGuardrails(list).map((g) => g.id)).toEqual(["l", "r1", "r2", "m"]);
  });
});

describe("inputGuardrails / streamGuardrails", () => {
  it("keep enabled ones in order and split by kind", () => {
    const list: AssistantGuardrail[] = [
      defaultGuardrail("moderation", "m"),
      { ...defaultGuardrail("input_length_limit", "off"), enabled: false },
      rule("<s>", "</s>"),
      defaultGuardrail("input_length_limit", "l"),
    ];
    // Run order, not list order: the exact length check before moderation.
    expect(inputGuardrails(list).map((g) => g.id)).toEqual(["l", "m"]);
    expect(streamGuardrails(list).map((g) => g.id)).toEqual(["<s>"]);
    expect(inputGuardrails(undefined)).toEqual([]);
  });

  it("never treat masking as an input check, and find the enabled one", () => {
    const masking = defaultGuardrail("pii_masking", "p");
    expect(inputGuardrails([masking])).toEqual([]);
    expect(streamGuardrails([masking])).toEqual([]);
    expect(maskingGuardrail([defaultGuardrail("moderation", "m"), masking])?.id).toBe("p");
    expect(maskingGuardrail([{ ...masking, enabled: false }])).toBeNull();
    expect(maskingGuardrail(undefined)).toBeNull();
  });
});

describe("deterministicViolation", () => {
  const length = (unit: "characters" | "tokens", max: number) =>
    ({ ...defaultGuardrail("input_length_limit", "l"), unit, max }) as InputGuardrail;

  it("counts characters as code points, not UTF-16 units", () => {
    expect(deterministicViolation(length("characters", 3), "😀😀😀")).toBe(false);
    expect(deterministicViolation(length("characters", 3), "abcd")).toBe(true);
  });

  it("estimates tokens at four characters each", () => {
    expect(deterministicViolation(length("tokens", 2), "12345678")).toBe(false);
    expect(deterministicViolation(length("tokens", 2), "123456789")).toBe(true);
  });

  it("matches a regex case-insensitively when asked", () => {
    const regex = (caseInsensitive: boolean) =>
      ({ ...defaultGuardrail("regexp_guardrail", "r"), pattern: "\\bpassword\\b", caseInsensitive }) as InputGuardrail;
    expect(deterministicViolation(regex(true), "my PASSWORD is")).toBe(true);
    expect(deterministicViolation(regex(false), "my PASSWORD is")).toBe(false);
  });

  it("leaves model-backed types to the runtime", () => {
    expect(deterministicViolation(defaultGuardrail("moderation", "m") as InputGuardrail, "x")).toBeNull();
  });
});

describe("createMarkerSuppressor", () => {
  const rules = [rule("<secret>", "</secret>", "[hidden]")];
  const text = "Before <secret>token 123</secret> after.";

  it("replaces a span with the message, shown once", () => {
    expect(suppressMarkedContent(text, rules)).toBe("Before [hidden] after.");
  });

  it("gives the same text however the stream is chunked", () => {
    for (let size = 1; size <= text.length; size++) {
      const s = createMarkerSuppressor(rules);
      let out = "";
      for (let i = 0; i < text.length; i += size) out += s.push(text.slice(i, i + size));
      out += s.end();
      expect(out, `chunk size ${size}`).toBe("Before [hidden] after.");
    }
  });

  it("never shows a marker split across deltas", () => {
    const s = createMarkerSuppressor(rules);
    const shown = [s.push("Hi <sec"), s.push("ret>x"), s.push("</sec"), s.push("ret> bye"), s.end()];
    expect(shown.join("")).toBe("Hi [hidden] bye");
    expect(shown[0]).toBe("Hi ");
  });

  it("keeps a span the model never closes hidden", () => {
    expect(suppressMarkedContent("ok <secret>leak", rules)).toBe("ok [hidden]");
  });

  it("releases a held tail that turned out not to be a marker", () => {
    expect(suppressMarkedContent("a <sec", rules)).toBe("a <sec");
  });

  it("handles several rules and several spans", () => {
    const both = [rule("[[", "]]", "*"), rule("<<", ">>", "#")];
    expect(suppressMarkedContent("a [[x]] b <<y>> c [[z]]", both)).toBe("a * b # c *");
  });

  it("is a pass-through with no rules", () => {
    expect(suppressMarkedContent(text, [])).toBe(text);
  });
});
