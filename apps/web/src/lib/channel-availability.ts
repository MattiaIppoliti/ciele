import { channelAvailabilityNow as evaluateChannelAvailability } from "@agent-hub/core";
import type { BusinessHoursCalendar, ChannelAvailability } from "@agent-hub/core";

/** Supply the browser clock; all calendar decisions belong to core. */
export function channelAvailabilityNow(availability: ChannelAvailability, now = new Date(), schedules: readonly BusinessHoursCalendar[] = []) {
  return evaluateChannelAvailability(availability, now, schedules);
}
