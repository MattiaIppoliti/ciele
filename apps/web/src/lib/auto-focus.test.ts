import { afterEach, describe, expect, it, vi } from "vitest";
import { canAutoFocus } from "./auto-focus";

function stubPointer(fine: boolean) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: query === "(pointer: fine)" && fine }),
  });
}

describe("canAutoFocus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is false on the server", () => {
    expect(canAutoFocus()).toBe(false);
  });

  it("focuses with a mouse or trackpad", () => {
    stubPointer(true);
    expect(canAutoFocus()).toBe(true);
  });

  it("does not focus on a touch screen", () => {
    stubPointer(false);
    expect(canAutoFocus()).toBe(false);
  });
});
