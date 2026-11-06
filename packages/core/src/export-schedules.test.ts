import { expect, it } from "vitest";
import { exportScheduleDue, exportScheduleSlot, exportScheduleWindow } from "./export-schedules";
it("uses the latest weekly slot after a drifting tick and a single catch-up after an outage", () => {
  const schedule = { cadence: { kind: "weekly" as const, weekday: 1 }, hour: 8, enabled: true, createdAt: "2026-01-01T00:00:00Z", lastSlotAt: "2026-01-05T08:00:00Z" };
  const now = new Date("2026-02-02T10:17:00Z");
  const slot = exportScheduleSlot(schedule, now);
  expect(slot.toISOString()).toBe("2026-02-02T08:00:00.000Z");
  expect(exportScheduleDue(schedule, now)).toBe(true);
  expect(exportScheduleDue({ ...schedule, lastSlotAt: slot.toISOString() }, now)).toBe(false);
  expect(exportScheduleWindow(schedule, slot)).toEqual({ from: "2026-01-26", to: "2026-02-01" });
});
it("clamps monthly day 31 and rolls the report to the previous calendar month", () => {
  const schedule = { cadence: { kind: "monthly" as const, day: 31 }, hour: 9 };
  expect(exportScheduleSlot(schedule, new Date("2026-02-28T08:00:00Z")).toISOString()).toBe("2026-01-31T09:00:00.000Z");
  const slot = exportScheduleSlot(schedule, new Date("2026-02-28T10:00:00Z"));
  expect(slot.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  expect(exportScheduleWindow(schedule, slot)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
});
it("does not backfill a slot before creation or run a paused schedule", () => {
  const schedule = { cadence: { kind: "weekly" as const, weekday: 1 }, hour: 8, enabled: true, createdAt: "2026-02-02T10:00:00Z", lastSlotAt: null };
  expect(exportScheduleDue(schedule, new Date("2026-02-02T11:00:00Z"))).toBe(false);
  expect(exportScheduleDue({ ...schedule, enabled: false }, new Date("2026-02-09T11:00:00Z"))).toBe(false);
});
