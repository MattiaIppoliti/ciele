import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveFeedbackRuntime, type FeedbackRuntime } from "@agent-hub/ui/feedback";
import { setNotificationListener } from "@/lib/notification-bus";
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
    setNotificationListener(null);
  });

  it("sounds the outcome without any call site knowing", () => {
    setActiveFeedbackRuntime(runtime);
    setNotificationListener(() => {});
    toast.success("Published");
    toast.error("Upload failed");
    toast.info("Syncing");
    toast.message("Note");
    expect(play.mock.calls.map((c) => c[0])).toEqual(["success", "error"]);
  });

  it("is silent where no provider is mounted", () => {
    setNotificationListener(() => {});
    expect(() => toast.success("Published")).not.toThrow();
    expect(play).not.toHaveBeenCalled();
  });
});
