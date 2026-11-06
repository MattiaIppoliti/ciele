import type { AuditLogEntry, AuditLogFilter } from "@agent-hub/core";

/**
 * Settings > Audit log, its URL state. Filters live in the query string so a
 * filtered view is a link and the page stays a server read. Pure, so it is
 * tested; vitest ignores `.tsx`.
 */
export interface AuditLogView {
  /** Operation names, any of them. */
  actions: string[];
  /** A Member's user id, `system`, or "" for anyone. */
  actor: string;
  /** An operation domain such as `assistants`, kept from older links. */
  domain: string;
  /** yyyy-mm-dd, inclusive; "" when unset. */
  from: string;
  /** yyyy-mm-dd, inclusive; "" when unset. */
  to: string;
  oldest: boolean;
  limit: number;
}

export const AUDIT_LOG_PAGE_SIZE = 100;
export const AUDIT_LOG_MAX_LIMIT = 1000;

type SearchParams = Record<string, string | string[] | undefined>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const OPERATION = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;
const DOMAIN = /^[a-zA-Z0-9_-]+$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseAuditLogView(params: SearchParams): AuditLogView {
  const actions = first(params.action)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => OPERATION.test(value))
    .slice(0, 50);
  const from = first(params.from).slice(0, 10);
  const to = first(params.to).slice(0, 10);
  const domain = first(params.domain);
  const limit = Number.parseInt(first(params.limit), 10);
  return {
    actions,
    // `memberId` is what the page called it before the actor filter.
    actor: (first(params.actor) || first(params.memberId)).slice(0, 64),
    domain: DOMAIN.test(domain) ? domain : "",
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    oldest: first(params.sort) === "asc",
    limit:
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, AUDIT_LOG_MAX_LIMIT) : AUDIT_LOG_PAGE_SIZE,
  };
}

/** The view as the Db filter. Dates are whole UTC days, both inclusive. */
export function auditLogFilter(view: AuditLogView): AuditLogFilter {
  return {
    operations: view.actions.length > 0 ? view.actions : undefined,
    memberId: view.actor || undefined,
    domain: view.domain || undefined,
    from: view.from ? `${view.from}T00:00:00.000Z` : undefined,
    to: view.to ? `${view.to}T23:59:59.999Z` : undefined,
    order: view.oldest ? "oldest" : "newest",
    limit: view.limit,
  };
}

/** The view as a query string, leaving out every default. */
export function auditLogQuery(view: AuditLogView): string {
  const params = new URLSearchParams();
  if (view.actions.length > 0) params.set("action", view.actions.join(","));
  if (view.actor) params.set("actor", view.actor);
  if (view.domain) params.set("domain", view.domain);
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  if (view.oldest) params.set("sort", "asc");
  if (view.limit !== AUDIT_LOG_PAGE_SIZE) params.set("limit", String(view.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isFiltered(view: AuditLogView): boolean {
  return view.actions.length > 0 || Boolean(view.actor || view.domain || view.from || view.to);
}

/** Who made a change, in the order the log reads it: a key or a Teammate before the Member behind it. */
export function auditActorKind(entry: Pick<AuditLogEntry, "memberId" | "apiKeyId" | "teammateId">): "apiKey" | "teammate" | "member" | "system" {
  if (entry.apiKeyId) return "apiKey";
  if (entry.teammateId) return "teammate";
  return entry.memberId ? "member" : "system";
}

const WHEN_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** "04 Nov 2026, 13:10 UTC". UTC like the Inbox, so server and browser agree. */
export function formatAuditWhen(iso: string): string {
  return `${WHEN_FORMATTER.format(new Date(iso))} UTC`;
}

/** A change's value as the detail sheet prints it: text as is, structure as JSON. */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}
