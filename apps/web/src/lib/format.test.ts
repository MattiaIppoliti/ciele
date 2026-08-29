import { describe, expect, it } from "vitest";
import { formatDateTime, formatDay } from "./format";

describe("UTC date formatting", () => {
  it("keeps the existing day and date-time output", () => {
    const timestamp = "2026-07-03T07:44:00.000Z";

    expect(formatDay(timestamp)).toBe("03 Jul 2026");
    expect(formatDateTime(timestamp)).toBe("03 Jul 26 07:44");
  });
});
