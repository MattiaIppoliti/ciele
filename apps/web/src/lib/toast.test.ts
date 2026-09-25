import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveFeedbackRuntime, type FeedbackRuntime } from "@agent-hub/ui/feedback";
import { feedbackForStatus, toast } from "./toast";

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
  const runtime: FeedbackRuntime = { play, unlocked: true, destroy: () => {} };

  afterEach(() => {
    play.mockClear();
    setActiveFeedbackRuntime(null);
  });

  it("sounds the outcome without any call site knowing", () => {
    setActiveFeedbackRuntime(runtime);
    toast.success("Published");
    toast.error("Upload failed");
    toast.info("Syncing");
    toast.message("Note");
    expect(play.mock.calls.map((c) => c[0])).toEqual(["success", "error"]);
  });

  it("does not require a mounted feedback provider or browser window", () => {
    expect(() => toast.success("Published")).not.toThrow();
    expect(play).not.toHaveBeenCalled();
  });
});
