import { describe, expect, it } from "vitest";
import { messageText } from "./message";

describe("messageText", () => {
  it("joins text parts with a newline by default", () => {
    expect(
      messageText([
        { type: "text", text: "Hello" },
        { type: "text", text: "world" },
      ])
    ).toBe("Hello\nworld");
  });

  it("joins with a custom separator", () => {
    expect(
      messageText(
        [
          { type: "text", text: "Hello" },
          { type: "text", text: "world" },
        ],
        " "
      )
    ).toBe("Hello world");
  });

  it("skips non-text parts", () => {
    expect(
      messageText([
        { type: "text", text: "Answer" },
        { type: "button", label: "Open", url: "https://example.com" },
        { type: "clarify", question: "Which plan are you on?" },
      ])
    ).toBe("Answer");
  });

  it("skips empty text parts instead of emitting blank lines", () => {
    expect(
      messageText([
        { type: "text", text: "" },
        { type: "text", text: "kept" },
        { type: "text" },
      ])
    ).toBe("kept");
  });

  it("tolerates malformed parts", () => {
    expect(
      messageText([null, undefined, 42, "loose string", {}, { type: "text", text: "ok" }])
    ).toBe("ok");
  });

  it("handles the user-message shape ([{type:'text', text}])", () => {
    expect(messageText([{ type: "text", text: "How do I reset my password?" }])).toBe(
      "How do I reset my password?"
    );
  });

  it("returns an empty string for empty content", () => {
    expect(messageText([])).toBe("");
  });
});
