import { describe, expect, it, vi } from "vitest";
import { createSignal } from "./signal";

describe("a one-slot signal", () => {
  it("reaches the listener that holds the slot", () => {
    const signal = createSignal();
    const listener = vi.fn();
    signal.listen(listener);
    signal.fire();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is a no-op with nobody listening, since the caller's own navigation does the work", () => {
    expect(() => createSignal().fire()).not.toThrow();
  });

  it("stops reaching a listener that released the slot", () => {
    const signal = createSignal();
    const listener = vi.fn();
    signal.listen(listener);
    signal.listen(null);
    signal.fire();
    expect(listener).not.toHaveBeenCalled();
  });
});
