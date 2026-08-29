import type { TicketingPlatform } from "@agent-hub/core";

export interface TicketingPlatformMeta {
  label: string;
  /** Shown in the placeholder logo tile until real brand marks are wired up. */
  initials: string;
  color: string;
}

export const TICKETING_PLATFORMS: Record<TicketingPlatform, TicketingPlatformMeta> = {
  servicenow: { label: "ServiceNow", initials: "SN", color: "bg-emerald-600" },
};
