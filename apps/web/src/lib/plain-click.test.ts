import { describe, expect, it } from "vitest";
import { isPlainClick } from "./plain-click";

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("isPlainClick", () => {
  it("accepts an unmodified primary click", () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  it("refuses any modifier or another button", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isPlainClick({ ...plain, [key]: true })).toBe(false);
    }
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
  });
});
