import { describe, expect, it, vi } from "vitest";
import { discardChangesRequest, warnBeforeUnload } from "./use-unsaved-changes";

describe("warnBeforeUnload", () => {
  it("makes the browser prompt until it is released", () => {
    const target = new EventTarget();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const release = warnBeforeUnload(target);
    expect(unload()).toBe(true);
    release();
    expect(unload()).toBe(false);
  });
});

describe("discardChangesRequest", () => {
  it("words every form's confirm the same way and leaves on confirm", () => {
    const go = vi.fn();
    const request = discardChangesRequest("The edits to this channel are not saved yet.", go);
    expect(request).toMatchObject({
      title: "Discard your changes?",
      description: "The edits to this channel are not saved yet.",
      confirmLabel: "Discard changes",
    });
    void request.onConfirm();
    expect(go).toHaveBeenCalledOnce();
  });

  it("has a description of its own when the form gives none", () => {
    expect(discardChangesRequest(undefined, () => {}).description).toBe(
      "Your edits are not saved yet.",
    );
  });
});
