import type { ExportSchedule } from "./types";
/** Latest UTC slot, clamping monthly days to that month's final day. */
export function exportScheduleSlot(schedule: Pick<ExportSchedule, "cadence" | "hour">, now: Date): Date {
  const year = now.getUTCFullYear(); const month = now.getUTCMonth();
  if (schedule.cadence.kind === "weekly") {
    const date = now.getUTCDate() - (now.getUTCDay() - schedule.cadence.weekday + 7) % 7;
    const slot = new Date(Date.UTC(year, month, date, schedule.hour));
    if (slot > now) slot.setUTCDate(slot.getUTCDate() - 7);
    return slot;
  }
  const preferredDay = schedule.cadence.day;
  const monthly = (offset: number) => new Date(Date.UTC(year, month + offset, Math.min(preferredDay, new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate()), schedule.hour));
  const current = monthly(0);
  return current > now ? monthly(-1) : current;
}
export function exportScheduleDue(schedule: Pick<ExportSchedule, "cadence" | "hour" | "enabled" | "createdAt" | "lastSlotAt">, now: Date): boolean {
  const slot = exportScheduleSlot(schedule, now).getTime();
  return schedule.enabled && slot >= Date.parse(schedule.createdAt) && (!schedule.lastSlotAt || Date.parse(schedule.lastSlotAt) < slot);
}
/** Date filters always cover closed UTC days, never the saved date window. */
export function exportScheduleWindow(schedule: Pick<ExportSchedule, "cadence">, slot: Date): { from: string; to: string } {
  const year = slot.getUTCFullYear(); const month = slot.getUTCMonth(); const date = slot.getUTCDate();
  const from = schedule.cadence.kind === "weekly" ? new Date(Date.UTC(year, month, date - 7)) : new Date(Date.UTC(year, month - 1, 1));
  const to = schedule.cadence.kind === "weekly" ? new Date(Date.UTC(year, month, date - 1)) : new Date(Date.UTC(year, month, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
