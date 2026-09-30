import { describe, expect, it } from "vitest";
import { showMessageTimeSeparator } from "./message-time-separator";

describe("message time separators", () => {
  it("shows the first dated message", () => {
    expect(showMessageTimeSeparator("2026-09-30T11:00:00")).toBe(true);
  });
  it("keeps rapid messages and pauses under two hours together", () => {
    expect(showMessageTimeSeparator("2026-09-30T12:03:00", "2026-09-30T11:21:00")).toBe(false);
    expect(showMessageTimeSeparator("2026-09-30T12:03:10", "2026-09-30T12:03:00")).toBe(false);
  });
  it("starts a session after two hours", () => {
    expect(showMessageTimeSeparator("2026-09-30T13:00:00", "2026-09-30T11:00:00")).toBe(true);
  });
  it("separates days even with a short pause", () => {
    expect(showMessageTimeSeparator("2026-10-01T00:01:00", "2026-09-30T23:59:00")).toBe(true);
  });
  it("ignores absent and invalid current dates", () => {
    expect(showMessageTimeSeparator(null)).toBe(false);
    expect(showMessageTimeSeparator("invalid")).toBe(false);
  });
});
