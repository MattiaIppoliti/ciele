import type { TicketingPlatform } from "@agent-hub/db";

export interface TicketingPlatformMeta {
  label: string;
  /** Shown in the placeholder logo tile until real brand marks are wired up. */
  initials: string;
  color: string;
}

export const TICKETING_PLATFORMS: Record<TicketingPlatform, TicketingPlatformMeta> = {
  servicenow: { label: "ServiceNow", initials: "SN", color: "bg-emerald-600" },
  jira: { label: "Jira", initials: "J", color: "bg-blue-600" },
  salesforce: { label: "Salesforce", initials: "SF", color: "bg-sky-500" },
  topdesk: { label: "Topdesk", initials: "TD", color: "bg-red-500" },
  solarwinds: { label: "SolarWinds", initials: "SW", color: "bg-amber-500" },
  hubspot: { label: "Hubspot", initials: "H", color: "bg-orange-500" },
  halo: { label: "Halo", initials: "HA", color: "bg-teal-500" },
  faqtory: { label: "FAQtory", initials: "FQ", color: "bg-green-600" },
  teamdynamix: { label: "TeamDynamix", initials: "TDX", color: "bg-indigo-600" },
  zendesk: { label: "Zendesk", initials: "ZD", color: "bg-neutral-800" },
  ivanti: { label: "Ivanti", initials: "IV", color: "bg-orange-600" },
};

export const TICKETING_PLATFORM_ORDER: TicketingPlatform[] = [
  "servicenow",
  "jira",
  "salesforce",
  "topdesk",
  "solarwinds",
  "hubspot",
  "halo",
  "faqtory",
  "teamdynamix",
  "zendesk",
  "ivanti",
];

/** Only these platforms have a working connect flow so far. */
export const SUPPORTED_TICKETING_PLATFORMS: TicketingPlatform[] = ["servicenow"];
