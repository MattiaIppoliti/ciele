import { daysBetween } from "./usage-dashboard";

export type AssistantAvailabilityStatus = "up" | "degraded" | "down";
export type AssistantAvailabilityIssue =
  | "http_error"
  | "timeout"
  | "invalid_config"
  | "slow_response"
  | "network_error";

export interface AssistantAvailabilityTarget {
  id: string;
  organizationId: string;
  title: string;
}

/** An independent configuration-endpoint check, never a model call. */
export interface AssistantAvailabilityCheck {
  assistantId: string;
  organizationId: string;
  checkedAt: string;
  status: AssistantAvailabilityStatus;
  latencyMs: number;
  issue: AssistantAvailabilityIssue | null;
}

export interface AssistantAvailabilityFact {
  assistantId: string;
  day: string;
  status: AssistantAvailabilityStatus;
  issue: AssistantAvailabilityIssue | null;
  checks: number;
  lastCheckedAt: string;
}

export interface AssistantStatusDay {
  date: string;
  status: AssistantAvailabilityStatus | "none";
  checks: number;
  failedChecks: number;
  degradedChecks: number;
  incidents: { title: string; checks: number }[];
}

const ISSUE_LABELS: Record<AssistantAvailabilityIssue, string> = {
  http_error: "Endpoint returned an error",
  timeout: "Endpoint timed out",
  invalid_config: "Endpoint returned an invalid configuration",
  slow_response: "Slow configuration response",
  network_error: "Endpoint could not be reached",
};

/** A missing sample remains unknown. Success rate is weighted by checks, not days. */
export function assistantAvailabilityDays(
  assistantId: string,
  facts: readonly AssistantAvailabilityFact[],
  from: string,
  to: string,
): AssistantStatusDay[] {
  const byDay = new Map<string, AssistantAvailabilityFact[]>();
  for (const fact of facts) {
    if (fact.assistantId !== assistantId) continue;
    const entries = byDay.get(fact.day) ?? [];
    entries.push(fact);
    byDay.set(fact.day, entries);
  }
  return daysBetween(from, to).map((date) => {
    const entries = byDay.get(date) ?? [];
    const checks = entries.reduce((sum, row) => sum + row.checks, 0);
    const failedChecks = entries.reduce(
      (sum, row) => sum + (row.status === "down" ? row.checks : 0),
      0,
    );
    const degradedChecks = entries.reduce(
      (sum, row) => sum + (row.status === "degraded" ? row.checks : 0),
      0,
    );
    return {
      date,
      checks,
      failedChecks,
      degradedChecks,
      status:
        checks === 0
          ? "none"
          : failedChecks > 0
            ? "down"
            : degradedChecks > 0
              ? "degraded"
              : "up",
      incidents: entries
        .filter((row) => row.issue !== null)
        .map((row) => ({
          title: row.issue ? ISSUE_LABELS[row.issue] : "Endpoint issue",
          checks: row.checks,
        })),
    };
  });
}

export function availabilitySummary(days: readonly AssistantStatusDay[]) {
  const checks = days.reduce((sum, day) => sum + day.checks, 0);
  const failed = days.reduce((sum, day) => sum + day.failedChecks, 0);
  return { checks, uptime: checks > 0 ? (checks - failed) / checks : null };
}

/** A stale successful check cannot claim the endpoint is currently operational. */
export function currentAssistantAvailability(
  assistantId: string,
  facts: readonly AssistantAvailabilityFact[],
  now: Date,
): AssistantAvailabilityStatus | "none" {
  const latest = facts
    .filter((fact) => fact.assistantId === assistantId)
    .sort((a, b) => b.lastCheckedAt.localeCompare(a.lastCheckedAt))[0];
  if (!latest) return "none";
  const age = now.getTime() - Date.parse(latest.lastCheckedAt);
  return Number.isFinite(age) && age >= 0 && age <= 10 * 60_000
    ? latest.status
    : "none";
}
