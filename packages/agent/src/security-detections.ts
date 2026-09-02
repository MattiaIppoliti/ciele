import type { ObjectAccessEvent } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { alertKeys, signalHealth } from "./health";

/**
 * Detection-as-code over the sensitive-object access ledger (#801, CYB-19,
 * and the detections CYB-05 called for once the base event existed).
 *
 * The rules are pure functions over `ObjectAccessEvent[]`: portable (they name
 * no vendor, no query language), testable in CI like any other code, and
 * versioned with the events they read. The cron adapter below turns findings
 * into the same keyed Alert idiom every other health producer uses, so a
 * detection surfaces where operators already look, deduped by sourceKey and
 * auto-resolving when the behavior stops.
 *
 * Thresholds are deliberately far from ordinary use: a detection that pages on
 * a person clicking citations trains everyone to ignore it, which is worse
 * than no detection. Tune them downward with evidence, not by feel.
 */

/** How far back one detection tick looks. */
export const DETECTION_WINDOW_HOURS = 24;

/**
 * Knowledge-original transfers by one actor in one window past which the
 * volume itself is the signal (exfiltration or a scraping loop), whoever the
 * actor is. `served` and `aborted` both count: a caller who fetches most of
 * every original and cancels has still moved the bytes, and a rule that only
 * counted completed transfers was a rule with a documented way around it.
 */
export const BULK_DOWNLOAD_THRESHOLD = 50;

/** The ledger results that mean bytes left the building. */
const TRANSFERRED: ReadonlySet<ObjectAccessEvent["result"]> = new Set([
  "served",
  "aborted",
]);

/**
 * Refused attempts from one address in one window past which the pattern is a
 * probe. The widget route additionally rate-limits refusals at the source;
 * this reads what still landed on the ledger, across routes.
 */
export const REFUSAL_PROBE_THRESHOLD = 20;

export interface SecurityFinding {
  rule: "bulk-download" | "refusal-probe" | "new-address";
  organizationId: string;
  /** The actor (bulk-download) or address (refusal-probe) the rule fired on. */
  subject: string;
  count: number;
  title: string;
  detail: string;
}

/** Rule 1: one actor served an unusual volume of originals. */
export function detectBulkDownloads(
  organizationId: string,
  events: ObjectAccessEvent[],
  threshold = BULK_DOWNLOAD_THRESHOLD
): SecurityFinding[] {
  const served = new Map<string, number>();
  for (const event of events) {
    if (!TRANSFERRED.has(event.result)) continue;
    if (event.objectKind !== "knowledge_original") continue;
    const actor = `${event.actorKind}:${event.actorId ?? "unknown"}`;
    served.set(actor, (served.get(actor) ?? 0) + 1);
  }
  const findings: SecurityFinding[] = [];
  for (const [actor, count] of served) {
    if (count < threshold) continue;
    findings.push({
      rule: "bulk-download",
      organizationId,
      subject: actor,
      count,
      title: "Unusual download volume of knowledge originals",
      detail: `${actor} transferred ${count} knowledge originals (completed or aborted downloads) in the last ${DETECTION_WINDOW_HOURS}h (threshold ${threshold}). Review the object access ledger for this actor; if unexpected, revoke the credential or disable direct access and preserve the ledger rows.`,
    });
  }
  return findings;
}

/** Rule 2: one address collecting refusals is probing. */
export function detectRefusalProbes(
  organizationId: string,
  events: ObjectAccessEvent[],
  threshold = REFUSAL_PROBE_THRESHOLD
): SecurityFinding[] {
  const refused = new Map<string, number>();
  for (const event of events) {
    if (event.result !== "refused") continue;
    const address = event.ip ?? "unknown";
    refused.set(address, (refused.get(address) ?? 0) + 1);
  }
  const findings: SecurityFinding[] = [];
  for (const [address, count] of refused) {
    if (count < threshold) continue;
    findings.push({
      rule: "refusal-probe",
      organizationId,
      subject: address,
      count,
      title: "Repeated refused object access from one address",
      detail: `${count} refused object-access attempts from ${address} in the last ${DETECTION_WINDOW_HOURS}h (threshold ${threshold}). This is what enumeration looks like; review the ledger rows for this address and consider blocking it upstream.`,
    });
  }
  return findings;
}

/**
 * How much history an actor needs before an unseen address is a signal. A
 * new hire's first week is all new addresses; a credential that downloaded
 * from one office for a month and suddenly speaks from elsewhere is not.
 */
export const NEW_ADDRESS_MIN_BASELINE = 5;

/** How far back the baseline reaches, relative to the detection window. */
export const NEW_ADDRESS_BASELINE_DAYS = 30;

/**
 * Rule 3: a known actor served downloads from an address their baseline has
 * never seen (#801, CYB-05's "new-IP" detection). Members and API keys only:
 * an anonymous visitor id is caller-supplied correlation, not an identity,
 * so "new address for this visitor" asserts nothing.
 */
export function detectNewAddressDownloads(
  organizationId: string,
  windowEvents: ObjectAccessEvent[],
  baselineEvents: ObjectAccessEvent[],
  minBaseline = NEW_ADDRESS_MIN_BASELINE
): SecurityFinding[] {
  const baseline = new Map<string, { count: number; addresses: Set<string> }>();
  for (const event of baselineEvents) {
    if (!TRANSFERRED.has(event.result)) continue;
    if (event.actorKind !== "member" && event.actorKind !== "api_key") continue;
    const actor = `${event.actorKind}:${event.actorId ?? "unknown"}`;
    const entry = baseline.get(actor) ?? { count: 0, addresses: new Set<string>() };
    entry.count += 1;
    if (event.ip) entry.addresses.add(event.ip);
    baseline.set(actor, entry);
  }

  const findings: SecurityFinding[] = [];
  const flagged = new Set<string>();
  for (const event of windowEvents) {
    if (!TRANSFERRED.has(event.result)) continue;
    if (event.actorKind !== "member" && event.actorKind !== "api_key") continue;
    if (!event.ip) continue;
    const actor = `${event.actorKind}:${event.actorId ?? "unknown"}`;
    const history = baseline.get(actor);
    // No history is no signal: a brand-new actor's every address is new.
    if (!history || history.count < minBaseline) continue;
    if (history.addresses.has(event.ip)) continue;
    const key = `${actor}@${event.ip}`;
    if (flagged.has(key)) continue;
    flagged.add(key);
    findings.push({
      rule: "new-address",
      organizationId,
      subject: key,
      count: 1,
      title: "Known credential downloading from a new address",
      detail: `${actor} was served a knowledge original from ${event.ip}, an address absent from its last ${NEW_ADDRESS_BASELINE_DAYS} days of downloads. Expected for travel or a network change; if not, treat the credential as exposed, revoke it, and preserve the ledger rows.`,
    });
  }
  return findings;
}

/** Every rule, over one organization's window. Order is the report order. */
export function runDetectionRules(
  organizationId: string,
  events: ObjectAccessEvent[],
  baselineEvents: ObjectAccessEvent[] = []
): SecurityFinding[] {
  return [
    ...detectBulkDownloads(organizationId, events),
    ...detectRefusalProbes(organizationId, events),
    ...detectNewAddressDownloads(organizationId, events, baselineEvents),
  ];
}

export interface SecurityDetectionsReport {
  detections: {
    organizations: number;
    findings: number;
    results: Array<{
      organizationId: string;
      findings: number;
      error?: string;
    }>;
  };
}

/**
 * How many ledger rows one page of the tick's read carries. The read is
 * paginated, newest first, until the baseline horizon is covered: one page
 * used to be the whole read, and a tenant with more rows than that in 30 days
 * lost the *oldest* baseline first, so the new-address rule fired on addresses
 * that were in the ledger and simply never loaded (#801 review, CYB-19).
 */
export const DETECTION_PAGE_SIZE = 5_000;

/**
 * Pages one tick will read per organization before it stops. Half a million
 * rows in 30 days is not a ledger this rule set is sized for; past it the
 * tick reports what it read rather than reading forever.
 */
export const DETECTION_MAX_PAGES = 100;

/**
 * The whole ledger window for one organization, however many pages it spans.
 * Stops when a page comes back short, which is the only signal the offset
 * read has that the horizon is reached.
 *
 * Deduplicated by event id: the read is newest-first over a live ledger, so an
 * insert that lands between two pages shifts every older row down by one and
 * the last row of page N comes back again as the first row of page N+1. The
 * bulk-download rule counts rows, and a duplicated row is a download that
 * never happened (#801 review, round 2).
 */
async function readLedgerWindow(
  db: Db,
  organizationId: string,
  sinceIso: string
): Promise<ObjectAccessEvent[]> {
  const history: ObjectAccessEvent[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < DETECTION_MAX_PAGES; page++) {
    const rows = await db.listObjectAccessEvents(organizationId, {
      sinceIso,
      limit: DETECTION_PAGE_SIZE,
      offset: page * DETECTION_PAGE_SIZE,
    });
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      history.push(row);
    }
    if (rows.length < DETECTION_PAGE_SIZE) break;
  }
  return history;
}

/**
 * The cron tick: reads each organization's ledger window and turns findings
 * into keyed Alerts. Raise-only by design, no auto-resolve: a security
 * finding is evidence to triage, and evidence must not clear itself when the
 * behavior pauses. `signalHealth` dedups by sourceKey, so a still-firing rule
 * updates its Alert in place rather than stacking new ones. One organization
 * failing never aborts the rest.
 */
export async function runSecurityDetections(
  deps: { db: Db },
  options: { now?: Date } = {}
): Promise<SecurityDetectionsReport> {
  const { db } = deps;
  const now = options.now ?? new Date();
  const since = new Date(
    now.getTime() - DETECTION_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();
  const baselineSince = new Date(
    now.getTime() - NEW_ADDRESS_BASELINE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const organizations = await db.listOrganizations();

  const results = await Promise.all(
    organizations.map(async (organization) => {
      try {
        // One read, paged to the baseline horizon, covers both rules; the
        // split at the window cutoff is what separates "the last day" from
        // "the month before it".
        const history = await readLedgerWindow(db, organization.id, baselineSince);
        const events = history.filter((event) => event.createdAt >= since);
        const baseline = history.filter((event) => event.createdAt < since);
        const findings = runDetectionRules(organization.id, events, baseline);
        for (const finding of findings) {
          await signalHealth(
            db,
            organization.id,
            {
              key: alertKeys.securityDetection(finding.rule, finding.subject),
              healthy: false,
              alert: {
                type: "system",
                title: finding.title,
                detail: finding.detail,
              },
            },
            "security-detections"
          );
        }
        return { organizationId: organization.id, findings: findings.length };
      } catch (error) {
        return {
          organizationId: organization.id,
          findings: 0,
          error: error instanceof Error ? error.message : "detection tick failed",
        };
      }
    })
  );

  return {
    detections: {
      organizations: organizations.length,
      findings: results.reduce((sum, r) => sum + r.findings, 0),
      results,
    },
  };
}
