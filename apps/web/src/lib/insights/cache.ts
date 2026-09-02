import { revalidateTag } from "next/cache";

/**
 * The one tag the cached Insights overview carries (ADR-0005 as amended).
 * Keyed by Organization and nothing narrower: every Member of an Organization
 * reads the same aggregate, so one expiry serves the whole roster.
 */
export const insightsOrganizationTag = (organizationId: string) =>
  `insights:${organizationId}`;

export function expireOrganizationInsights(organizationId: string) {
  revalidateTag(insightsOrganizationTag(organizationId), { expire: 0 });
}
