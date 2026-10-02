import { describe, expect, it } from "vitest";
import { textCompletion } from "./text-completion";

const complete = (value: string, suggestions: string[], extra = {}) =>
  textCompletion({ value, suggestions, start: value.length, end: value.length, ...extra });

describe("textCompletion", () => {
  it("accepts an empty field's visible suggestion or a matching prefix", () => {
    expect(complete("", ["Hello there"])).toBe("Hello there");
    expect(complete("hel", ["Other", "Hello there"])).toBe("Hello there");
  });
  it("does not replace unrelated text, a selection, or text edited in the middle", () => {
    expect(complete("bye", ["Hello there"])).toBeNull();
    expect(complete("Hello", ["Hello there"], { start: 2, end: 2 })).toBeNull();
    expect(complete("Hello", ["Hello there"], { start: 0, end: 5 })).toBeNull();
  });
  it("leaves Tab alone without a remaining valid completion", () => {
    expect(complete("", [])).toBeNull();
    expect(complete("Hello", ["Hello"])).toBeNull();
    expect(complete("Hi", ["Hi there"], { maxLength: 4 })).toBeNull();
  });
});
