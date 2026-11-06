import { describe, expect, it } from "vitest";
import { defaultChannelAvailability } from "./defaults";
import type { BusinessHours, WeekDay } from "./types";
import { businessHoursAt } from "./business-hours";
const make = (day: WeekDay, opensHour: number, closesHour: number, timezone = "UTC"): BusinessHours => ({
  id: "office", organizationId: "org", name: "Office", timezone, isDefault: true,
  hours: { ...defaultChannelAvailability().hours, [day]: { enabled: true, ranges: [{ id: "shift", opensHour, opensMinute: 0, closesHour, closesMinute: 0 }] } },
  holidays: [], createdAt: "", updatedAt: "",
});
describe("Business hours at an instant", () => {
  it("opens overnight and stops at the closing minute", () => {
    const schedule = make("monday", 22, 2);
    expect(businessHoursAt(schedule, new Date("2026-07-07T01:00Z")).available).toBe(true);
    expect(businessHoursAt(schedule, new Date("2026-07-07T02:00Z")).available).toBe(false);
  });
  it("closes a whole holiday day in the middle of an overnight window", () => {
    const schedule = make("monday", 22, 2);
    schedule.holidays = [{ id: "break", name: "Closure", startDate: "2026-07-07", endDate: "2026-07-07", yearly: false }];
    expect(businessHoursAt(schedule, new Date("2026-07-07T01:00Z")).available).toBe(false);
    expect(businessHoursAt(schedule, new Date("2026-07-07T01:00Z")).nextOpening?.toISOString()).toBe("2026-07-13T22:00:00.000Z");
  });
  it("skips yearly holiday ranges across New Year", () => {
    const schedule = make("monday", 9, 17);
    schedule.holidays = [{ id: "winter", name: "Winter", startDate: "2020-12-24", endDate: "2021-01-06", yearly: true }];
    expect(businessHoursAt(schedule, new Date("2026-12-28T10:00Z")).nextOpening?.toISOString()).toBe("2027-01-11T09:00:00.000Z");
  });
  it("finds the actual opening after a daylight-saving gap", () => {
    const schedule = make("sunday", 2, 4, "Europe/Rome");
    expect(businessHoursAt(schedule, new Date("2026-03-29T00:30Z")).nextOpening?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });
  it("handles the repeated clock hour and a timezone east of UTC", () => {
    const schedule = make("sunday", 2, 3, "Europe/Rome");
    expect(businessHoursAt(schedule, new Date("2026-10-25T01:30Z")).available).toBe(true);
    expect(businessHoursAt(make("monday", 9, 17, "Pacific/Auckland"), new Date("2026-07-05T21:00Z")).available).toBe(true);
  });
});

it("reads a Flow's referenced holiday live and leaves missing schedules unevaluatable", async () => {
  const { evaluateFlowCondition, flowConditionDefect } = await import("./flow-conditions");
  const condition = { id: "condition", kind: "schedule", mode: "business_hours", businessHoursId: "office", direction: "during" } as const;
  const schedule = make("monday", 9, 17);
  const now = new Date("2026-07-06T12:00Z");
  expect(evaluateFlowCondition(condition, { now, businessHours: [schedule] })).toBe(true);
  schedule.holidays.push({ id: "closure", name: "Closure", startDate: "2026-07-06", endDate: "2026-07-06", yearly: false });
  expect(evaluateFlowCondition(condition, { now, businessHours: [schedule] })).toBe(false);
  expect(evaluateFlowCondition({ ...condition, direction: "outside" }, { now, businessHours: [schedule] })).toBe(true);
  expect(evaluateFlowCondition(condition, { now, businessHours: [] })).toBe(null);
  expect(flowConditionDefect(condition, [])).toBe("schedule_business_hours_missing");
});
