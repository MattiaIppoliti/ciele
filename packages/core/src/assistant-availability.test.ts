import { describe, expect, it } from "vitest";
import {
  assistantAvailabilityDays,
  availabilitySummary,
  currentAssistantAvailability,
} from "./assistant-availability";
import type { AssistantAvailabilityFact } from "./assistant-availability";

const facts: AssistantAvailabilityFact[] = [
  {
    assistantId: "a",
    day: "2026-10-08",
    status: "up",
    issue: null,
    checks: 96,
    lastCheckedAt: "2026-10-08T12:00:00Z",
  },
  {
    assistantId: "a",
    day: "2026-10-08",
    status: "degraded",
    issue: "slow_response",
    checks: 3,
    lastCheckedAt: "2026-10-08T11:00:00Z",
  },
  {
    assistantId: "a",
    day: "2026-10-08",
    status: "down",
    issue: "timeout",
    checks: 1,
    lastCheckedAt: "2026-10-08T10:00:00Z",
  },
  {
    assistantId: "other",
    day: "2026-10-07",
    status: "down",
    issue: "timeout",
    checks: 100,
    lastCheckedAt: "2026-10-07T12:00:00Z",
  },
];
describe("observed assistant availability", () => {
  it("keeps gaps unknown and counts slow responses as available", () => {
    const days = assistantAvailabilityDays(
      "a",
      facts,
      "2026-10-07",
      "2026-10-09",
    );
    expect(days.map((d) => d.status)).toEqual(["none", "down", "none"]);
    expect(availabilitySummary(days)).toEqual({ checks: 100, uptime: 0.99 });
    expect(days[1].incidents).toEqual([
      { title: "Slow configuration response", checks: 3 },
      { title: "Endpoint timed out", checks: 1 },
    ]);
    expect(availabilitySummary([]).uptime).toBeNull();
  });
  it("uses the newest sample, expiring current status after ten minutes", () => {
    expect(
      currentAssistantAvailability(
        "a",
        facts,
        new Date("2026-10-08T12:05:00Z"),
      ),
    ).toBe("up");
    expect(
      currentAssistantAvailability(
        "a",
        facts,
        new Date("2026-10-08T12:11:00Z"),
      ),
    ).toBe("none");
    expect(
      currentAssistantAvailability(
        "a",
        facts,
        new Date("2026-10-08T11:59:00Z"),
      ),
    ).toBe("none");
  });
});
