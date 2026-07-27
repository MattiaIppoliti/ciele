import type { Alert } from "@agent-hub/core";
import { describe, expect, it } from "vitest";

import {
  alertNotification,
  autoDismisses,
  visibleNotifications,
  type AppNotification,
} from "@/lib/notifications";

function event(
  id: string,
  createdAt: number,
  status: AppNotification["status"] = "success",
): AppNotification {
  return { id, status, title: id, createdAt, source: "event" };
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
  it("only self-clears successes and notices raised by the UI", () => {
    expect(autoDismisses(event("e1", 1, "success"))).toBe(true);
    expect(autoDismisses(event("e2", 1, "info"))).toBe(true);
    expect(autoDismisses(event("e3", 1, "error"))).toBe(false);
    expect(autoDismisses(event("e4", 1, "warning"))).toBe(false);
    // Alerts persist until resolved, whatever their severity reads as.
    expect(autoDismisses({ ...event("a", 1, "info"), source: "alert" })).toBe(
      false,
    );
  });

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

  it("orders newest first, puts the just-raised event ahead of an alert, and caps", () => {
    const alerted = { ...event("alert:a1", 100), source: "alert" as const };
    const items = visibleNotifications(
      [alerted, event("e1", 100), event("e2", 300), event("e3", 200)],
      { limit: 3 },
    );

    expect(items.map((i) => i.id)).toEqual(["e2", "e3", "e1"]);
  });

  it("drops dismissed ids", () => {
    const items = visibleNotifications([event("e1", 2), event("e2", 1)], {
      limit: 3,
      dismissed: new Set(["e1"]),
    });

    expect(items.map((i) => i.id)).toEqual(["e2"]);
  });
});
