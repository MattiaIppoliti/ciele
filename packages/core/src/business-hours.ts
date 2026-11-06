import type { BusinessHoursCalendar, Holiday, WeekDay } from "./types";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const WEEK: WeekDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function holidayOn(date: string, holiday: Pick<Holiday, "startDate" | "endDate" | "yearly">): boolean {
  if (!holiday.yearly) return holiday.startDate <= date && date <= holiday.endDate;
  const value = date.slice(5);
  const start = holiday.startDate.slice(5);
  const end = holiday.endDate.slice(5);
  return start <= end ? start <= value && value <= end : value >= start || value <= end;
}

/** A pure local-calendar evaluator shared by channels and Flow hard gates. */
export function businessHoursAt(schedule: Pick<BusinessHoursCalendar, "timezone" | "hours" | "holidays">, now: Date): { available: boolean; nextOpening: Date | null } {
  if (!Number.isFinite(now.getTime())) return { available: false, nextOpening: null };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch { return { available: false, nextOpening: null }; }
  const local = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
  };
  const rangesFor = (day: number) => schedule.hours[WEEK[(day + 7) % 7]];
  const segments = (day: number): [number, number][] => {
    const today = rangesFor(day);
    const previous = rangesFor(day - 1);
    return [
      ...(today?.enabled ? today.ranges.flatMap(range => {
        const start = range.opensHour * 60 + range.opensMinute;
        const end = range.closesHour * 60 + range.closesMinute;
        return start === end ? [] : [[start, end > start ? end : 1440] as [number, number]];
      }) : []),
      ...(previous?.enabled ? previous.ranges.flatMap(range => {
        const start = range.opensHour * 60 + range.opensMinute;
        const end = range.closesHour * 60 + range.closesMinute;
        return end < start && end > 0 ? [[0, end] as [number, number]] : [];
      }) : []),
    ];
  };
  const current = local(now);
  const currentDay = new Date(`${current.date}T00:00:00Z`).getUTCDay();
  const isOpen = (date: string, minute: number, daySegments: [number, number][]) => !schedule.holidays.some(holiday => holidayOn(date, holiday)) && daySegments.some(([start, end]) => start <= minute && minute < end);
  if (isOpen(current.date, current.minute, segments(currentDay))) return { available: true, nextOpening: null };
  if (!WEEK.some((_, day) => segments(day).length)) return { available: false, nextOpening: null };

  const yearly = schedule.holidays.filter(holiday => holiday.yearly);
  if (yearly.length && Array.from({ length: 366 }, (_, day) => new Date(Date.UTC(2000, 0, day + 1)).toISOString().slice(0, 10)).every(date => yearly.some(holiday => holidayOn(date, holiday)))) return { available: false, nextOpening: null };

  let calendar = Date.parse(`${current.date}T00:00:00Z`);
  // The Gregorian calendar, including weekday/leap-day alignments, repeats in 400 years.
  // Nonrepeating closures are jumped over rather than limiting how far ahead we can see.
  const cycleEnd = calendar + (146097 + 7) * DAY_MS;
  let horizon = cycleEnd;
  for (; calendar <= horizon; calendar += DAY_MS) {
    const date = new Date(calendar).toISOString().slice(0, 10);
    const closing = schedule.holidays.find(holiday => !holiday.yearly && holidayOn(date, holiday));
    if (closing) {
      const end = Date.parse(`${closing.endDate}T00:00:00Z`);
      if (Number.isFinite(end)) {
        horizon = Math.max(horizon, end + (146097 + 7) * DAY_MS);
        calendar = end;
      }
      continue;
    }
    if (schedule.holidays.some(holiday => holidayOn(date, holiday))) continue;
    const daySegments = segments(new Date(calendar).getUTCDay());
    if (!daySegments.length) continue;
    // Search actual minute instants only on candidate local days. This also handles
    // skipped/repeated clock times without inventing an offset for an IANA zone.
    const start = Math.max(calendar - 14 * 60 * MINUTE_MS, Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
    for (let instant = start; instant < calendar + 36 * 60 * MINUTE_MS; instant += MINUTE_MS) {
      const value = local(new Date(instant));
      if (value.date > date) break;
      if (value.date === date && daySegments.some(([opens, closes]) => opens <= value.minute && value.minute < closes)) return { available: false, nextOpening: new Date(instant) };
    }
  }
  return { available: false, nextOpening: null };
}

/** The Widget label is a projection of the same opening decision as Flow routing. */
export function channelAvailabilityNow(availability: import("./types").ChannelAvailability, now: Date, schedules: readonly BusinessHoursCalendar[] = []): { available: boolean; nextWindow: string | null } {
  if (availability.mode === "always") return { available: true, nextWindow: null };
  const schedule = availability.mode === "business_hours" ? schedules.find(row => row.id === availability.businessHoursId) : { ...availability, holidays: [] };
  if (!schedule) return { available: false, nextWindow: null };
  const state = businessHoursAt(schedule, now);
  if (!state.nextOpening) return { available: state.available, nextWindow: null };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone || "UTC", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(state.nextOpening);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const weekday = WEEK.find(day => day === get("weekday").toLowerCase());
  if (!weekday) return { available: false, nextWindow: null };
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  const day = schedule.hours[weekday];
  const previous = schedule.hours[WEEK[(WEEK.indexOf(weekday) + 6) % 7]];
  const range = day?.enabled ? day.ranges.find(range => {
    const start = range.opensHour * 60 + range.opensMinute;
    const end = range.closesHour * 60 + range.closesMinute;
    return start <= minute && (end > start ? minute < end : true);
  }) : undefined;
  const carry = previous?.enabled ? previous.ranges.find(range => range.closesHour * 60 + range.closesMinute < range.opensHour * 60 + range.opensMinute && minute < range.closesHour * 60 + range.closesMinute) : undefined;
  const closes = range ?? carry;
  const pad = (value: number) => String(value).padStart(2, "0");
  return { available: false, nextWindow: `${get("weekday")} ${get("hour")}:${get("minute")}${closes ? ` - ${pad(closes.closesHour)}:${pad(closes.closesMinute)}` : ""} (${schedule.timezone})` };
}
