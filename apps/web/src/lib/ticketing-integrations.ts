import type { ApplicationConnection, TicketingProvider, TicketingTarget } from "@agent-hub/core";

export interface TicketingPlatformMeta {
  label: string;
  /** Shown in the placeholder logo tile until real brand marks are wired up. */
  initials: string;
  color: string;
  /** What one filed record is called in that system. */
  record: string;
}

export const TICKETING_PLATFORMS: Record<TicketingProvider, TicketingPlatformMeta> = {
  salesforce: { label: "Salesforce", initials: "SF", color: "bg-sky-600", record: "Case" },
  servicenow: { label: "ServiceNow", initials: "SN", color: "bg-emerald-600", record: "record" },
};

/** The Connection fields the Ticketing Integration picker renders; never the credential. */
export type TicketingConnectionOption = Pick<
  ApplicationConnection,
  "id" | "provider" | "name" | "status" | "ownerType"
>;

/**
 * The Connections a desk may file through (#1088): Salesforce and ServiceNow,
 * Organization-owned only. A Member-owned Connection is never offered, the
 * operation would refuse it anyway, and offering what will be refused is how
 * a picker lies.
 */
export function ticketingConnectionOptions(
  connections: TicketingConnectionOption[]
): Array<TicketingConnectionOption & { provider: TicketingProvider }> {
  return connections.filter(
    (connection): connection is TicketingConnectionOption & { provider: TicketingProvider } =>
      (connection.provider === "salesforce" || connection.provider === "servicenow") &&
      connection.ownerType === "organization"
  );
}

/** One line describing where a desk's tickets go. */
export function ticketingTargetSummary(
  target: TicketingTarget,
  connection: Pick<TicketingConnectionOption, "name"> | null
): string {
  const name = connection?.name ?? "A deleted connection";
  if (target.provider === "salesforce") return `${name} · Cases`;
  const column = target.requesterEmailField
    ? `, requester email in ${target.requesterEmailField}`
    : "";
  return `${name} · ${target.table} table${column}`;
}
