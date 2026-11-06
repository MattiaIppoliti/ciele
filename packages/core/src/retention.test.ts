import { describe, expect, it } from "vitest";
import {
  isRetentionWindowValid,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  retentionPeriodDays,
  retentionPeriodFromDays,
} from "./retention";

describe("retention periods", () => {
  it("reads a stored window in the largest unit that divides it", () => {
    expect(retentionPeriodFromDays(365)).toEqual({ amount: 1, unit: "years" });
    expect(retentionPeriodFromDays(1825)).toEqual({ amount: 5, unit: "years" });
    expect(retentionPeriodFromDays(90)).toEqual({ amount: 3, unit: "months" });
    expect(retentionPeriodFromDays(400)).toEqual({ amount: 400, unit: "days" });
  });

  it("round-trips every unit", () => {
    for (const days of [30, 60, 365, 730, 45, 1825]) {
      expect(retentionPeriodDays(retentionPeriodFromDays(days))).toBe(days);
    }
  });

  it("bounds auto-delete between one month and five years", () => {
    expect(isRetentionWindowValid(retentionPeriodDays({ amount: 1, unit: "months" }))).toBe(true);
    expect(isRetentionWindowValid(retentionPeriodDays({ amount: 5, unit: "years" }))).toBe(true);
    expect(isRetentionWindowValid(retentionPeriodDays({ amount: 2, unit: "days" }))).toBe(false);
    expect(isRetentionWindowValid(retentionPeriodDays({ amount: 6, unit: "years" }))).toBe(false);
    expect(isRetentionWindowValid(RETENTION_MIN_DAYS - 1)).toBe(false);
    expect(isRetentionWindowValid(RETENTION_MAX_DAYS + 1)).toBe(false);
    expect(isRetentionWindowValid(30.5)).toBe(false);
  });
});
