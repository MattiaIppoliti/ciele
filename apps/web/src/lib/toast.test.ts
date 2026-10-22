import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveFeedbackRuntime, type FeedbackRuntime } from "@agent-hub/ui/feedback";
import { feedbackForStatus, toast, undoAction } from "./toast";

describe("feedbackForStatus", () => {
  it("marks outcomes and nothing else", () => {
    expect(feedbackForStatus("success")).toBe("success");
    expect(feedbackForStatus("error")).toBe("error");
    expect(feedbackForStatus("warning")).toBe("warning");
    expect(feedbackForStatus("info")).toBeNull();
  });
});

describe("toast", () => {
  const play = vi.fn();
  const runtime: FeedbackRuntime = { play, destroy: () => {} };

  afterEach(() => {
    play.mockClear();
    setActiveFeedbackRuntime(null);
  });

  it("sounds the outcome without any call site knowing", () => {
    setActiveFeedbackRuntime(runtime);
    toast.success("Published");
    toast.error("Upload failed");
    toast.info("Syncing");
    expect(play.mock.calls.map((c) => c[0])).toEqual(["success", "error"]);
  });

  it("does not require a mounted feedback provider or browser window", () => {
    expect(() => toast.success("Published")).not.toThrow();
    expect(play).not.toHaveBeenCalled();
  });
});

describe("undoAction (#1074)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("reverts once, however often Undo is pressed", async () => {
    const revert = vi.fn();
    const action = undoAction(revert, vi.fn());
    expect(action.label).toBe("Undo");
    action.run();
    action.run();
    await settle();
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal answered as { ok: false } instead of passing in silence", async () => {
    const onError = vi.fn();
    undoAction(async () => ({ ok: false, error: "This task was deleted" }), onError).run();
    await settle();
    expect(onError).toHaveBeenCalledWith("This task was deleted");
  });

  it("reports a thrown refusal", async () => {
    const onError = vi.fn();
    undoAction(() => {
      throw new Error("Offline");
    }, onError).run();
    await settle();
    expect(onError).toHaveBeenCalledWith("Offline");
  });

  it("stays quiet when the revert succeeded", async () => {
    const onError = vi.fn();
    undoAction(async () => ({ ok: true }), onError).run();
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });
});
