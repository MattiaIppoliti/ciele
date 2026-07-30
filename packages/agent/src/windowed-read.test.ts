import { describe, expect, it } from "vitest";
import {
  MAX_READ_WINDOW_CHARS,
  readWindow,
  readWindowNote,
} from "./windowed-read";

const BIG = "x".repeat(200_000);

describe("readWindow", () => {
  it("reads the requested range and reports the total length", () => {
    const w = readWindow("abcdefghij", 2, 5);
    expect(w).toEqual({
      from: 2,
      to: 5,
      totalLength: 10,
      content: "cde",
      nextFrom: 5,
      clamped: false,
    });
  });

  it("walks a 200k payload window by window, total length known throughout", () => {
    let from: number | null = 0;
    let read = 0;
    let windows = 0;
    while (from !== null) {
      const w: ReturnType<typeof readWindow> = readWindow(BIG, from);
      expect(w.totalLength).toBe(200_000);
      expect(w.content.length).toBeLessThanOrEqual(MAX_READ_WINDOW_CHARS);
      read += w.content.length;
      windows += 1;
      from = w.nextFrom;
    }
    expect(read).toBe(200_000);
    expect(windows).toBe(200_000 / MAX_READ_WINDOW_CHARS);
  });

  it("caps a range wider than one window and flags it", () => {
    const w = readWindow(BIG, 0, 200_000);
    expect(w.to).toBe(MAX_READ_WINDOW_CHARS);
    expect(w.clamped).toBe(true);
    expect(w.nextFrom).toBe(MAX_READ_WINDOW_CHARS);
  });

  it("defaults an absent range to the first window", () => {
    expect(readWindow(BIG)).toMatchObject({
      from: 0,
      to: MAX_READ_WINDOW_CHARS,
      nextFrom: MAX_READ_WINDOW_CHARS,
    });
  });

  it("tolerates a reversed, negative, fractional or out-of-range request", () => {
    expect(readWindow("abcdef", 5, 2)).toMatchObject({ from: 5, to: 5, content: "" });
    expect(readWindow("abcdef", -10, 3)).toMatchObject({ from: 0, content: "abc" });
    expect(readWindow("abcdef", 1.7, 3.9)).toMatchObject({ from: 1, to: 3 });
    expect(readWindow("abcdef", 99)).toMatchObject({
      from: 6,
      to: 6,
      content: "",
      nextFrom: null,
    });
    expect(readWindow("abcdef", Number.NaN)).toMatchObject({ from: 0 });
  });

  it("has no next window when the payload ends", () => {
    expect(readWindow("abc", 0, 3).nextFrom).toBeNull();
    expect(readWindow("", 0).nextFrom).toBeNull();
  });
});

describe("readWindowNote", () => {
  it("says what was read and where to continue", () => {
    expect(readWindowNote(readWindow("abc"), "the response")).toBe(
      "Read all 3 characters of the response."
    );
    expect(readWindowNote(readWindow(BIG, 0), "the response")).toContain(
      "Read again from 8000"
    );
    expect(readWindowNote(readWindow(BIG, 199_000), "the response")).toContain(
      "this is the end"
    );
    expect(readWindowNote(readWindow(""), "the source")).toBe(
      "the source is empty."
    );
  });
});
