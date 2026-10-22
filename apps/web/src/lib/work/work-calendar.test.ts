import { describe, expect, it } from "vitest";
import {
  DATE_VIEW_DEFAULTS,
  barEditPatch,
  barGeometry,
  dateViewFromSearchParams,
  dayX,
  dependencyPath,
  isWeekend,
  monthGrid,
  monthLabel,
  reschedulePatch,
  shiftMonth,
  snapDays,
  timelineMonths,
  timelineRange,
  unscheduledCount,
  weekGrid,
  weekLabel,
  weekStart,
} from "./work-calendar";

describe("calendar grids", () => {
  it("starts every week on Monday", () => {
    expect(weekStart("2026-10-09")).toBe("2026-10-05");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(isWeekend("2026-10-10")).toBe(true);
    expect(isWeekend("2026-10-09")).toBe(false);
  });

  it("draws a month as five weeks when it fits, six when it spills", () => {
    const october = monthGrid("2026-10-01");
    expect(october).toHaveLength(35);
    expect(october[0]).toBe("2026-09-28");
    expect(october[34]).toBe("2026-11-01");
    // August 2026 starts on a Saturday and ends on a Monday: six rows.
    const august = monthGrid("2026-08-15");
    expect(august).toHaveLength(42);
    expect(august[0]).toBe("2026-07-27");
    expect(august.at(-1)).toBe("2026-09-06");
  });

  it("walks months and weeks across year ends", () => {
    expect(shiftMonth("2026-12-14", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(weekGrid("2026-12-31")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(monthLabel("2026-10-01")).toBe("October 2026");
    expect(weekLabel("2026-10-09")).toBe("5 – 11 Oct 2026");
    expect(weekLabel("2026-09-30")).toBe("28 Sep – 4 Oct 2026");
  });

  it("keeps a Task's length when it moves to another day", () => {
    expect(reschedulePatch({ startDate: "2026-10-05", dueDate: "2026-10-08" }, "2026-10-12")).toEqual({
      startDate: "2026-10-09",
      dueDate: "2026-10-12",
    });
    expect(reschedulePatch({ startDate: null, dueDate: "2026-10-08" }, "2026-10-01")).toEqual({
      startDate: null,
      dueDate: "2026-10-01",
    });
    expect(reschedulePatch({ startDate: "2026-10-05", dueDate: null }, "2026-10-20")).toEqual({
      startDate: "2026-10-05",
      dueDate: "2026-10-20",
    });
  });
});

describe("timeline", () => {
  const today = "2026-10-09";

  it("opens on a Monday a few weeks back, at the zoom's day width", () => {
    expect(timelineRange(today, "weeks")).toEqual({ start: "2026-09-14", days: 91, dayWidth: 32 });
    expect(timelineRange(today, "months")).toEqual({ start: "2026-08-10", days: 238, dayWidth: 11 });
  });

  it("places a bar from its start through its due date, a day at least", () => {
    const range = timelineRange(today, "weeks");
    expect(barGeometry(range, { startDate: "2026-09-14", dueDate: "2026-09-16" })).toEqual({ x: 0, width: 96 });
    expect(barGeometry(range, { startDate: null, dueDate: "2026-09-15" })).toEqual({ x: 32, width: 32 });
    // A start after the due date is ignored rather than drawn backwards.
    expect(barGeometry(range, { startDate: "2026-09-20", dueDate: "2026-09-15" })).toEqual({ x: 32, width: 32 });
    expect(barGeometry(range, { startDate: "2026-09-14", dueDate: null })).toBeNull();
    expect(unscheduledCount([{ dueDate: null }, { dueDate: "2026-10-01" }, { dueDate: null }])).toBe(2);
  });

  it("labels each month the header spans", () => {
    const months = timelineMonths(timelineRange(today, "weeks"));
    expect(months[0]).toEqual({ month: "2026-09-01", label: "Sep 2026", days: 17 });
    expect(months.reduce((sum, m) => sum + m.days, 0)).toBe(91);
  });

  it("snaps a drag to whole days and moves, stretches or shrinks the bar", () => {
    expect(snapDays(47, 32)).toBe(1);
    expect(snapDays(-15, 32)).toBe(0);
    expect(snapDays(-17, 32)).toBe(-1);
    const task = { startDate: "2026-10-05", dueDate: "2026-10-08" };
    expect(barEditPatch(task, "move", 2)).toEqual({ startDate: "2026-10-07", dueDate: "2026-10-10" });
    expect(barEditPatch(task, "end", -1)).toEqual({ startDate: "2026-10-05", dueDate: "2026-10-07" });
    expect(barEditPatch(task, "start", 10)).toEqual({ startDate: "2026-10-08", dueDate: "2026-10-08" });
    expect(barEditPatch(task, "end", -10)).toEqual({ startDate: "2026-10-05", dueDate: "2026-10-05" });
    expect(barEditPatch({ startDate: null, dueDate: "2026-10-08" }, "move", 1)).toEqual({ startDate: null, dueDate: "2026-10-09" });
    expect(barEditPatch({ startDate: null, dueDate: "2026-10-08" }, "start", -2)).toEqual({
      startDate: "2026-10-06",
      dueDate: "2026-10-08",
    });
    expect(barEditPatch({ startDate: null, dueDate: "2026-10-08" }, "end", 2)).toEqual({
      startDate: "2026-10-08",
      dueDate: "2026-10-10",
    });
    expect(barEditPatch({ startDate: null, dueDate: "2026-10-08" }, "end", -2)).toEqual({ startDate: null, dueDate: "2026-10-08" });
    expect(barEditPatch(task, "move", 0)).toBeNull();
  });

  it("draws a dependency as one curve between the two bars", () => {
    expect(dependencyPath({ x: 100, y: 18 }, { x: 200, y: 54 })).toBe("M100 18 C150 18 150 54 200 54");
    // A day before the range's start sits left of it.
    expect(dayX(timelineRange(today, "weeks"), "2026-09-13")).toBe(-32);
  });
});

describe("the date views' address", () => {
  it("reads the period, the date and the zoom from the URL", () => {
    expect(dateViewFromSearchParams(new URLSearchParams("period=week&date=2026-10-05&zoom=months"))).toEqual({
      period: "week",
      date: "2026-10-05",
      zoom: "months",
    });
    expect(dateViewFromSearchParams({ period: ["week", "month"] }).period).toBe("week");
  });

  it("falls back to this month at the week zoom for anything it cannot be", () => {
    expect(dateViewFromSearchParams(new URLSearchParams())).toEqual(DATE_VIEW_DEFAULTS);
    expect(dateViewFromSearchParams(new URLSearchParams("period=year&date=2026-02-31&zoom=days"))).toEqual(DATE_VIEW_DEFAULTS);
    expect(dateViewFromSearchParams({ date: "2026-1-5" }).date).toBe("");
  });
});
