import { describe, expect, it } from "vitest";
import { thrownMessage } from "./thrown-message";

/**
 * The reason this helper exists is the second case: PostgREST rejects with a
 * plain object carrying `message`, not an Error, so `error instanceof Error`
 * alone would swallow every real database cause behind the fallback.
 */

describe("thrownMessage", () => {
  it("reads an Error's message", () => {
    expect(thrownMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads `message` off a plain object, the PostgREST shape", () => {
    expect(
      thrownMessage({ message: 'column "x" does not exist', code: "42703" }, "fallback")
    ).toBe('column "x" does not exist');
  });

  it("falls back for a value with no usable message", () => {
    expect(thrownMessage("just a string", "fallback")).toBe("fallback");
    expect(thrownMessage(null, "fallback")).toBe("fallback");
    expect(thrownMessage(undefined, "fallback")).toBe("fallback");
    expect(thrownMessage({ code: "42703" }, "fallback")).toBe("fallback");
    // A non-string `message` is not a message.
    expect(thrownMessage({ message: 42 }, "fallback")).toBe("fallback");
  });

  it("returns an Error's empty message as-is rather than the fallback", () => {
    // Deliberate: an Error that chose to say nothing is still the real cause,
    // and masking it with the fallback would invent a message it never had.
    expect(thrownMessage(new Error(""), "fallback")).toBe("");
  });
});
