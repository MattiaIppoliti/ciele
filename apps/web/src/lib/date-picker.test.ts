import { describe, expect, it } from "vitest";
import { formatPickerDate, parseDateChip, validDateDay } from "./date-picker";

describe("date picker boundaries", () => {
  it("rejects impossible dates instead of silently constraining the selected day", () => {
    for (const text of ["30/02/2026", "29/02/2100", "31/04/2026", "00/12/2026", "12/13/2026", "12/12/0000"]) {
      expect(parseDateChip(text)).toBeNull();
    }
    expect(parseDateChip("29/02/2000")).toBe("2000-02-29");
    expect(parseDateChip(" 4/9/2026 ")).toBe("2026-09-04");
  });
  it("keeps the same calendar day when formatting ISO values", () => {
    expect(formatPickerDate("2026-09-04")).toBe("04 Sept 2026");
    expect(validDateDay("2026-9-4")).toBe(false);
    expect(validDateDay("2026-02-30")).toBe(false);
    expect(formatPickerDate("")).toBe("Pick a date");
  });
});
