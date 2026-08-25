import { describe, expect, it } from "vitest";
import type { TeammateRoutine } from "@agent-hub/core";
import { TEAMMATE_ROUTINE_CAP } from "@agent-hub/core";
import {
  capReason,
  formatWhen,
  scheduleLine,
  statusLine,
} from "./routine-copy";

/**
 * The schedule line is the one thing somebody checks before trusting a routine
 * to run without them, so it has to be true. The status line is what they read
 * when it did not.
 */

const routine = (over: Partial<TeammateRoutine> = {}): TeammateRoutine => ({
  id: "rt-1",
  organizationId: "org-1",
  teammateId: "tm-1",
  instruction: "Triage yesterday's feedback.",
  cadence: "daily",
  hour: 8,
  enabled: true,
  createdBy: "u-1",
  lastRunAt: null,
  lastStatus: null,
  lastDetail: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const now = new Date("2026-08-20T12:00:00.000Z");

describe("scheduleLine", () => {
  it("says UTC, because that is the schedule we actually honour", () => {
    // Converting to a local time we do not honour is a lie a user catches at
    // 09:00 in the summer, once, and never trusts again.
    expect(scheduleLine({ cadence: "daily", hour: 8 })).toBe(
      "Every day at 08:00 UTC"
    );
    expect(scheduleLine({ cadence: "weekly", hour: 17 })).toBe(
      "Every Monday at 17:00 UTC"
    );
    expect(scheduleLine({ cadence: "monthly", hour: 0 })).toBe(
      "The 1st of each month at 00:00 UTC"
    );
  });
});

describe("statusLine", () => {
  it("leads with Paused, so a stale failure does not read as live", () => {
    expect(
      statusLine(routine({ enabled: false, lastStatus: "failed" }), now)
    ).toBe("Paused");
  });

  it("surfaces the failure detail, which is what somebody needs to fix it", () => {
    expect(
      statusLine(
        routine({
          lastStatus: "failed",
          lastDetail: "No provider credential",
          lastRunAt: "2026-08-20T08:00:00.000Z",
        }),
        now
      )
    ).toBe("Last run failed: No provider credential");
  });

  it("says when the first run is, before there has been one", () => {
    expect(statusLine(routine(), now)).toContain("First run");
  });

  it("pairs the last run with the next one", () => {
    expect(
      statusLine(
        routine({ lastRunAt: "2026-08-20T08:00:00.000Z", lastStatus: "ok" }),
        now
      )
    ).toBe("Ran 4 hours ago, next in 20 hours");
  });
});

describe("formatWhen", () => {
  it("is coarse on purpose", () => {
    // "in 2 hours 58 minutes" is noise on a schedule, and it makes the row
    // re-render into a different string every minute.
    expect(formatWhen(new Date("2026-08-20T12:30:00Z"), now)).toBe("shortly");
    expect(formatWhen(new Date("2026-08-20T11:50:00Z"), now)).toBe("just now");
    expect(formatWhen(new Date("2026-08-20T15:00:00Z"), now)).toBe("in 3 hours");
    expect(formatWhen(new Date("2026-08-20T11:00:00Z"), now)).toBe("1 hour ago");
    expect(formatWhen(new Date("2026-08-23T12:00:00Z"), now)).toBe("in 3 days");
    expect(formatWhen(new Date("2026-08-19T12:00:00Z"), now)).toBe("1 day ago");
  });
});

describe("capReason", () => {
  it("says the way out rather than greying a button", () => {
    expect(capReason(0, TEAMMATE_ROUTINE_CAP)).toBeNull();
    expect(capReason(TEAMMATE_ROUTINE_CAP, TEAMMATE_ROUTINE_CAP)).toContain(
      "Delete or pause one"
    );
  });
});
