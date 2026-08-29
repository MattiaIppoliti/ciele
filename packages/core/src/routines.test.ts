import { describe, expect, it } from "vitest";
import {
  isRoutineConversation,
  isRoutineDue,
  routineConversationMetadata,
  routineNextRun,
  routineSlotStart,
  routineTitle,
} from "./routines";
import type { TeammateRoutine } from "./types";

/**
 * When an unattended run is due (#772). Pure: no database, no ambient clock.
 *
 * The property that matters is "once per window, whatever the tick does". A
 * cron that fires at 08:01 and again at 08:59 must produce one run, and a cron
 * that misses a day must not produce two the next morning either. Both fall
 * out of comparing the last run against the current *slot* rather than against
 * an elapsed duration, so the cases below are mostly about slot boundaries.
 */

const routine = (over: Partial<TeammateRoutine> = {}): TeammateRoutine => ({
  id: "rt-1",
  organizationId: "org-1",
  teammateId: "tm-1",
  instruction: "Triage yesterday's visitor feedback.",
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

const at = (iso: string) => new Date(iso);

describe("routineSlotStart", () => {
  it("puts a daily slot at the preferred hour today, once it has arrived", () => {
    expect(
      routineSlotStart({ cadence: "daily", hour: 8 }, at("2026-08-20T09:30:00Z"))
    ).toEqual(at("2026-08-20T08:00:00Z"));
  });

  it("falls back to yesterday's slot before the hour arrives", () => {
    // 07:00 is before today's 08:00 slot, so the current one is yesterday's.
    expect(
      routineSlotStart({ cadence: "daily", hour: 8 }, at("2026-08-20T07:00:00Z"))
    ).toEqual(at("2026-08-19T08:00:00Z"));
  });

  it("anchors a weekly slot to Monday", () => {
    // 2026-08-20 is a Thursday.
    expect(
      routineSlotStart({ cadence: "weekly", hour: 8 }, at("2026-08-20T09:00:00Z"))
    ).toEqual(at("2026-08-17T08:00:00Z"));
    // Sunday belongs to the week that started six days earlier, not to the
    // next one: `getUTCDay()` is 0 there, which is the off-by-one to get wrong.
    expect(
      routineSlotStart({ cadence: "weekly", hour: 8 }, at("2026-08-23T09:00:00Z"))
    ).toEqual(at("2026-08-17T08:00:00Z"));
  });

  it("anchors a monthly slot to the first, and steps back early on the 1st", () => {
    expect(
      routineSlotStart({ cadence: "monthly", hour: 8 }, at("2026-08-20T09:00:00Z"))
    ).toEqual(at("2026-08-01T08:00:00Z"));
    // 07:00 on the 1st: this month's slot has not opened yet.
    expect(
      routineSlotStart({ cadence: "monthly", hour: 8 }, at("2026-08-01T07:00:00Z"))
    ).toEqual(at("2026-07-01T08:00:00Z"));
  });
});

describe("isRoutineDue", () => {
  it("runs once per window however often the cron ticks", () => {
    const ran = routine({ lastRunAt: "2026-08-20T08:01:00Z" });
    // Two more ticks inside the same slot, both find the run already stamped.
    expect(isRoutineDue(ran, at("2026-08-20T08:59:00Z"))).toBe(false);
    expect(isRoutineDue(ran, at("2026-08-20T23:59:00Z"))).toBe(false);
    // Next day's slot opens it again, exactly once.
    expect(isRoutineDue(ran, at("2026-08-21T08:00:00Z"))).toBe(true);
  });

  it("does not fire twice to catch up on a missed day", () => {
    // A cron outage skipped two days. The routine is due, and one run clears
    // it: the slot comparison has no backlog to work through.
    const stale = routine({ lastRunAt: "2026-08-18T08:00:00Z" });
    expect(isRoutineDue(stale, at("2026-08-21T09:00:00Z"))).toBe(true);
    const afterOneRun = routine({ lastRunAt: "2026-08-21T09:00:01Z" });
    expect(isRoutineDue(afterOneRun, at("2026-08-21T09:30:00Z"))).toBe(false);
  });

  it("waits for the hour rather than for an elapsed duration", () => {
    // 20 hours have passed since the last run, but today's slot has not
    // opened. A duration-based rule would drift the routine earlier each day.
    const ran = routine({ lastRunAt: "2026-08-20T08:00:00Z" });
    expect(isRoutineDue(ran, at("2026-08-21T04:30:00Z"))).toBe(false);
    expect(isRoutineDue(ran, at("2026-08-21T08:00:00Z"))).toBe(true);
  });

  it("never runs a disabled routine", () => {
    expect(
      isRoutineDue(routine({ enabled: false, lastRunAt: null }), at("2026-08-20T09:00:00Z"))
    ).toBe(false);
  });

  it("does not fire the moment it is created", () => {
    // Created at 17:00 with an 08:00 daily cadence: today's slot is behind us,
    // but nobody asked for a run today. The first is tomorrow morning.
    const fresh = routine({ createdAt: "2026-08-20T17:00:00Z", lastRunAt: null });
    expect(isRoutineDue(fresh, at("2026-08-20T17:01:00Z"))).toBe(false);
    expect(isRoutineDue(fresh, at("2026-08-21T08:00:00Z"))).toBe(true);
  });

  it("runs a never-run routine once its first slot opens", () => {
    const fresh = routine({ createdAt: "2026-08-20T06:00:00Z", lastRunAt: null });
    expect(isRoutineDue(fresh, at("2026-08-20T08:30:00Z"))).toBe(true);
  });
});

describe("routineNextRun", () => {
  it("is null for a disabled routine and now for a due one", () => {
    expect(routineNextRun(routine({ enabled: false }), at("2026-08-20T09:00:00Z"))).toBeNull();
    const due = routine({ lastRunAt: "2026-08-19T08:00:00Z" });
    expect(routineNextRun(due, at("2026-08-20T09:00:00Z"))).toEqual(
      at("2026-08-20T09:00:00Z")
    );
  });

  it("steps one period past the current slot", () => {
    const ran = routine({ lastRunAt: "2026-08-20T08:00:00Z" });
    expect(routineNextRun(ran, at("2026-08-20T09:00:00Z"))).toEqual(
      at("2026-08-21T08:00:00Z")
    );
    const weekly = routine({ cadence: "weekly", lastRunAt: "2026-08-17T08:00:00Z" });
    expect(routineNextRun(weekly, at("2026-08-20T09:00:00Z"))).toEqual(
      at("2026-08-24T08:00:00Z")
    );
  });
});

describe("the run's Conversation", () => {
  it("is marked so the thread can label it, not left to look like a message", () => {
    const metadata = routineConversationMetadata(routine());
    expect(metadata.routineId).toBe("rt-1");
    expect(isRoutineConversation(metadata)).toBe(true);
    // An ordinary chat is not one, and neither is a missing metadata bag.
    expect(isRoutineConversation({})).toBe(false);
    expect(isRoutineConversation(null)).toBe(false);
  });
});

describe("routineTitle", () => {
  it("takes the first sentence, because routines have no title field", () => {
    expect(routineTitle("Triage feedback. Then file the worst ones.")).toBe(
      "Triage feedback."
    );
    expect(routineTitle("Line one\nLine two")).toBe("Line one");
  });

  it("trims a long one rather than breaking the row", () => {
    expect(routineTitle("x".repeat(200))).toHaveLength(80);
  });

  it("never renders empty", () => {
    expect(routineTitle("   ")).toBe("Routine");
  });
});
