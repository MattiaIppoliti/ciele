import { afterEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: sonner }));

import {
  publishNotification,
  setNotificationListener,
  type NotificationInput,
} from "@/lib/notification-bus";
import { toast } from "@/lib/toast";

afterEach(() => {
  setNotificationListener(null);
  vi.clearAllMocks();
});

describe("toast façade", () => {
  it("routes into the banner when one is mounted", () => {
    const seen: NotificationInput[] = [];
    setNotificationListener((input) => seen.push(input));

    toast.success("Published v3");
    toast.error("Upload failed");
    toast.warning("Crawl is slow");
    toast.info("Coming soon");
    toast.message("Neutral notice");

    expect(seen).toEqual([
      { status: "success", title: "Published v3" },
      { status: "error", title: "Upload failed" },
      { status: "warning", title: "Crawl is slow" },
      { status: "info", title: "Coming soon" },
      { status: "info", title: "Neutral notice" },
    ]);
    expect(sonner.success).not.toHaveBeenCalled();
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it("falls back to a toast outside the admin shell", () => {
    toast.success("Feedback sent");
    toast.error("Something broke");

    expect(sonner.success).toHaveBeenCalledWith("Feedback sent");
    expect(sonner.error).toHaveBeenCalledWith("Something broke");
  });

  it("releases the slot when the banner unmounts", () => {
    const listener = vi.fn();
    setNotificationListener(listener);
    expect(publishNotification({ status: "info", title: "one" })).toBe(true);

    setNotificationListener(null);
    expect(publishNotification({ status: "info", title: "two" })).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });
});
