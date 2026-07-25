import type { ChannelAvailability, WeekDay } from "@agent-hub/db";

/**
 * Availability of a support channel at a moment in time, in the channel's own
 * timezone. Pure and client-safe: the widget escalation menu renders the
 * Available/Unavailable pill and the "Next available: Monday 10:30 - 19:00
 * (Europe/Rome)" line from this.
 */
export interface ChannelAvailabilityNow {
  available: boolean;
  /** e.g. "Monday 10:30 - 19:00 (Europe/Rome)"; null when always available or never open. */
  nextWindow: string | null;
}

const WEEKDAYS: WeekDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const LABELS: Record<WeekDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Weekday index (0=Sunday) and minutes-since-midnight of `now` in `timezone`. */
function nowInZone(now: Date, timezone: string): { day: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday")
    );
    // "24" can appear at midnight with hour12: false.
    const hour = Number(get("hour")) % 24;
    return { day: dayIndex < 0 ? now.getDay() : dayIndex, minutes: hour * 60 + Number(get("minute")) };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

interface Window {
  opens: number;
  closes: number;
  label: string;
}

export function channelAvailabilityNow(
  availability: ChannelAvailability,
  now: Date = new Date()
): ChannelAvailabilityNow {
  if (availability.mode !== "limited") {
    return { available: true, nextWindow: null };
  }
  const { day, minutes } = nowInZone(now, availability.timezone);

  // A day's enabled opening windows, sorted by start, as minutes-of-day.
  const windows = (weekday: WeekDay): Window[] => {
    const d = availability.hours[weekday];
    if (!d?.enabled) return [];
    return d.ranges
      .map((r) => ({
        opens: r.opensHour * 60 + r.opensMinute,
        closes: r.closesHour * 60 + r.closesMinute,
        label: `${LABELS[weekday]} ${pad(r.opensHour)}:${pad(r.opensMinute)} - ${pad(r.closesHour)}:${pad(r.closesMinute)} (${availability.timezone})`,
      }))
      .sort((a, b) => a.opens - b.opens);
  };

  const today = windows(WEEKDAYS[day]);
  // Open now if the moment falls inside any of today's windows.
  if (today.some((w) => minutes >= w.opens && minutes < w.closes)) {
    return { available: true, nextWindow: null };
  }

  // Next opening: the earliest window still to come today, else the first
  // enabled day in the following week.
  const laterToday = today.find((w) => minutes < w.opens);
  if (laterToday) {
    return { available: false, nextWindow: laterToday.label };
  }
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = windows(WEEKDAYS[(day + offset) % 7]);
    if (candidate.length > 0) {
      return { available: false, nextWindow: candidate[0].label };
    }
  }
  return { available: false, nextWindow: null };
}
