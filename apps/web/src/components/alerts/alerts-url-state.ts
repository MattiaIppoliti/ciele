import { filtersFromSearchParams } from "@/lib/url-state";

/** The Alerts page's status tab, as the URL spells it (`?status=active`). */
export interface AlertsUrlState {
  status: "all" | "active" | "resolved";
}

export const DEFAULT_ALERTS_URL_STATE: AlertsUrlState = { status: "all" };

export function alertsUrlStateFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AlertsUrlState {
  return filtersFromSearchParams(params, DEFAULT_ALERTS_URL_STATE, {
    status: ["all", "active", "resolved"],
  });
}
