import type { Alert } from "@agent-hub/core";
import { describe, expect, it } from "vitest";

import {
  alertNotification,
  visibleNotifications,
  workNotification,
  type AppNotification,
} from "@/lib/notifications";

function mention(
  id: string,
  createdAt: number,
  status: AppNotification["status"] = "success",
): AppNotification {
  return { id, status, title: id, createdAt, source: "mention" };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "a1",
    organizationId: "org-1",
    type: "crawl",
    title: "Crawl failing",
    detail: "boom",
    status: "active",
    sourceKey: null,
    detectedAt: "2026-07-27T10:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("notifications", () => {
  it("maps an alert's type onto a severity, a tag and a stable id", () => {
    expect(alertNotification(alert({ type: "integration" }))).toMatchObject({
      id: "alert:a1",
      status: "error",
      tag: "Integration",
      title: "Crawl failing",
      description: "boom",
      source: "alert",
    });
    expect(alertNotification(alert({ type: "crawl" })).status).toBe("warning");
    expect(alertNotification(alert()).createdAt).toBe(
      Date.parse("2026-07-27T10:00:00.000Z"),
    );
  });

  it("orders newest first, puts alerts ahead of mentions at ties, and caps", () => {
    const alerted = { ...mention("alert:a1", 100), source: "alert" as const };
    const items = visibleNotifications(
      [mention("m1", 100), alerted, mention("m2", 300), mention("m3", 200)],
      { limit: 3 },
    );

    expect(items.map((i) => i.id)).toEqual(["m2", "m3", "alert:a1"]);
  });

  it("drops dismissed ids", () => {
    const items = visibleNotifications([mention("m1", 2), mention("m2", 1)], {
      limit: 3,
      dismissed: new Set(["m1"]),
    });

    expect(items.map((i) => i.id)).toEqual(["m2"]);
  });
});

describe("workNotification", () => {
  it("shows a Member Notification as one card keyed by its row", () => {
    const card = workNotification({
      id: "n1",
      kind: "mentioned",
      createdAt: "2026-10-09T10:00:00.000Z",
      text: "Ada mentioned you on WEB-12",
      taskTitle: "Fix the footer",
      excerpt: "Can you look?",
    });
    expect(card).toEqual({
      id: "work:n1",
      status: "info",
      title: "Ada mentioned you on WEB-12",
      description: "“Can you look?”",
      tag: "Mention",
      createdAt: Date.parse("2026-10-09T10:00:00.000Z"),
      source: "work",
    });
    expect(
      workNotification({ id: "n2", kind: "assigned", createdAt: "2026-10-09T10:00:00.000Z", text: "x", taskTitle: "Fix the footer", excerpt: null })
        .description
    ).toBe("Fix the footer");
  });
});
