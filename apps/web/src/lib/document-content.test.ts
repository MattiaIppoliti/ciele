import { describe, expect, it } from "vitest";
import { CONTENT_FOLD_CHARS, contentHead, foldAt } from "./document-content";

describe("foldAt", () => {
  it("does not fold a body that fits", () => {
    expect(foldAt("short", 100)).toBe(5);
  });

  it("cuts at the last line break, so the fold is not mid-sentence", () => {
    const body = "line one\nline two\n" + "x".repeat(100);
    expect(foldAt(body, 20)).toBe(17);
  });

  it("cuts before an unclosed fence rather than inside it", () => {
    // Without this the excerpt ends with an opening ``` and the renderer reads
    // everything after it as code.
    const body = "intro\n\n```sql\nSELECT 1\nSELECT 2\nSELECT 3\n```\nafter";
    const cut = foldAt(body, 30);
    const head = body.slice(0, cut);
    expect((head.match(/```/g) ?? []).length % 2).toBe(0);
    expect(head).toBe("intro\n");
  });

  it("keeps a closed fence whole when it fits", () => {
    const body = "```\ncode\n```\n" + "tail\n".repeat(50);
    const head = body.slice(0, foldAt(body, 40));
    expect((head.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it("falls back to the hard limit for a body with no usable break", () => {
    expect(foldAt("x".repeat(10_000), 4000)).toBe(4000);
    // A break too early is worse than none: it would show almost nothing.
    expect(foldAt("x\n" + "y".repeat(10_000), 4000)).toBe(4000);
  });

  it("folds a million-character body at the default limit", () => {
    expect(foldAt("y".repeat(1_000_000))).toBe(CONTENT_FOLD_CHARS);
  });
});

describe("contentHead", () => {
  it("ships a short body whole", () => {
    expect(contentHead("hello")).toEqual({ head: "hello", total: 5, folded: false });
  });

  it("ships only the head of a long body, and says how long the body is", () => {
    // The route paints fast because the client never receives the megabytes
    // it will not show; "Show all" fetches them.
    const body = "para\n".repeat(200_000);
    const result = contentHead(body);
    expect(result.folded).toBe(true);
    expect(result.total).toBe(body.length);
    expect(result.head.length).toBeLessThanOrEqual(CONTENT_FOLD_CHARS);
    expect(result.head.endsWith("para")).toBe(true);
  });
});
