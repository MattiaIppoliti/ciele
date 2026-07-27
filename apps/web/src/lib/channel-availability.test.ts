import { describe, expect, it } from "vitest";
import type { ChannelAvailability, DayAvailability, WeekDay } from "@agent-hub/core";
import { channelAvailabilityNow } from "./channel-availability";

/**
 * The escalation menu's Available/Unavailable logic, pinned in UTC so the
 * assertions don't depend on the machine's local timezone.
 */

const closed: DayAvailability = { enabled: false, ranges: [] };

function hours(
  overrides: Partial<Record<WeekDay, DayAvailability>>
): ChannelAvailability["hours"] {
  return {
    monday: closed,
    tuesday: closed,
    wednesday: closed,
    thursday: closed,
    friday: closed,
    saturday: closed,
    sunday: closed,
    ...overrides,
  };
}

const mondayShift: DayAvailability = {
  enabled: true,
  ranges: [
    { id: "r0", opensHour: 10, opensMinute: 30, closesHour: 19, closesMinute: 0 },
  ],
};

// 2026-07-06 is a Monday.
const mondayNoonUtc = new Date("2026-07-06T12:00:00Z");
const mondayEarlyUtc = new Date("2026-07-06T06:00:00Z");
const saturdayUtc = new Date("2026-07-04T12:00:00Z");

describe("channelAvailabilityNow", () => {
  it("always-available channels are available with no next window", () => {
    const availability: ChannelAvailability = {
      mode: "always",
      timezone: "UTC",
      hours: hours({}),
    };
    expect(channelAvailabilityNow(availability, saturdayUtc)).toEqual({
      available: true,
      nextWindow: null,
    });
  });

  it("is available inside the day's window", () => {
    const availability: ChannelAvailability = {
      mode: "limited",
      timezone: "UTC",
      hours: hours({ monday: mondayShift }),
    };
    expect(channelAvailabilityNow(availability, mondayNoonUtc).available).toBe(
      true
    );
  });

  it("is closed in the gap between two windows and points at the next one", () => {
    // Split shift 09:00–12:00 and 14:00–18:00; 13:00 falls in the lunch gap.
    const splitShift: DayAvailability = {
      enabled: true,
      ranges: [
        { id: "am", opensHour: 9, opensMinute: 0, closesHour: 12, closesMinute: 0 },
        { id: "pm", opensHour: 14, opensMinute: 0, closesHour: 18, closesMinute: 0 },
      ],
    };
    const availability: ChannelAvailability = {
      mode: "limited",
      timezone: "UTC",
      hours: hours({ monday: splitShift }),
    };
    const mondayLunchUtc = new Date("2026-07-06T13:00:00Z");
    expect(channelAvailabilityNow(availability, mondayLunchUtc)).toEqual({
      available: false,
      nextWindow: "Monday 14:00 - 18:00 (UTC)",
    });
    // Inside the afternoon window it is available again.
    expect(
      channelAvailabilityNow(availability, new Date("2026-07-06T15:00:00Z"))
        .available
    ).toBe(true);
  });

  it("before opening it points at today's window", () => {
    const availability: ChannelAvailability = {
      mode: "limited",
      timezone: "UTC",
      hours: hours({ monday: mondayShift }),
    };
    expect(channelAvailabilityNow(availability, mondayEarlyUtc)).toEqual({
      available: false,
      nextWindow: "Monday 10:30 - 19:00 (UTC)",
    });
  });

  it("on a closed day it points at the next enabled day", () => {
    const availability: ChannelAvailability = {
      mode: "limited",
      timezone: "UTC",
      hours: hours({ monday: mondayShift }),
    };
    expect(channelAvailabilityNow(availability, saturdayUtc)).toEqual({
      available: false,
      nextWindow: "Monday 10:30 - 19:00 (UTC)",
    });
  });

  it("respects the channel's own timezone", () => {
    // 23:00 UTC Sunday is 01:00 Monday in Rome (UTC+2 in July) — before opening.
    const availability: ChannelAvailability = {
      mode: "limited",
      timezone: "Europe/Rome",
      hours: hours({ monday: mondayShift }),
    };
    const sundayLateUtc = new Date("2026-07-05T23:00:00Z");
    expect(channelAvailabilityNow(availability, sundayLateUtc)).toEqual({
      available: false,
      nextWindow: "Monday 10:30 - 19:00 (Europe/Rome)",
    });
  });

  it("never-open limited channels are unavailable with no next window", () => {
    const availability: ChannelAvailability = {
      mode: "limited",
      timezone: "UTC",
      hours: hours({}),
    };
    expect(channelAvailabilityNow(availability, mondayNoonUtc)).toEqual({
      available: false,
      nextWindow: null,
    });
  });
});
