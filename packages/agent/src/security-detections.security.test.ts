import { describe, expect, it, vi } from "vitest";
import type { ObjectAccessEvent } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  BULK_DOWNLOAD_THRESHOLD,
  DETECTION_PAGE_SIZE,
  NEW_ADDRESS_MIN_BASELINE,
  REFUSAL_PROBE_THRESHOLD,
  detectBulkDownloads,
  detectNewAddressDownloads,
  detectRefusalProbes,
  runSecurityDetections,
} from "./security-detections";

/**
 * #801, CYB-19 (and the detections CYB-05 asked for). The rules are the
 * portable, CI-validated half of detection-as-code: these tests are what
 * "validated in CI" means, so a threshold or grouping change that silences a
 * rule fails here rather than in an incident review.
 */

const ORG = "org-1";

function event(overrides: Partial<ObjectAccessEvent>): ObjectAccessEvent {
  return {
    id: "e",
    organizationId: ORG,
    actorKind: "member",
    actorId: "user-1",
    objectKind: "knowledge_original",
    objectPath: "org-1/file.pdf",
    sourceId: null,
    result: "served",
    bytes: 1,
    ip: "203.0.113.7",
    userAgent: null,
    requestId: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

const repeat = (count: number, overrides: Partial<ObjectAccessEvent>) =>
  Array.from({ length: count }, (_, i) => event({ id: `e-${i}`, ...overrides }));

/**
 * Twelve hours after the fixtures' `createdAt`, inside the 24h detection
 * window. Every `runSecurityDetections` call pins this: with the default
 * wall clock, these tests held for exactly one day after they were written
 * and then the fixtures aged out of the window.
 */
const NOW = new Date("2026-08-30T12:00:00.000Z");

describe("detectBulkDownloads", () => {
  it("fires at the threshold, attributing the actor and the count", () => {
    const events = [
      ...repeat(BULK_DOWNLOAD_THRESHOLD, { actorId: "downloader" }),
      ...repeat(3, { actorId: "colleague" }),
    ];
    const findings = detectBulkDownloads(ORG, events);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "bulk-download",
      subject: "member:downloader",
      count: BULK_DOWNLOAD_THRESHOLD,
    });
  });

  it("counts an aborted transfer as volume: most of a file is still the file", () => {
    // The loophole the round-1 review named (#801, CYB-05/19): fetch 99% of
    // each original and cancel, and a rule that counts only `served` never
    // fires. `aborted` is bytes that left, so it pools with `served`.
    const events = [
      ...repeat(BULK_DOWNLOAD_THRESHOLD - 1, { actorId: "canceller", result: "aborted" }),
      event({ actorId: "canceller", result: "served" }),
    ];
    const findings = detectBulkDownloads(ORG, events);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      subject: "member:canceller",
      count: BULK_DOWNLOAD_THRESHOLD,
    });
    // `failed` stays ours, and stays out.
    expect(
      detectBulkDownloads(
        ORG,
        repeat(BULK_DOWNLOAD_THRESHOLD, { actorId: "unlucky", result: "failed" })
      )
    ).toHaveLength(0);
  });

  it("stays quiet below the threshold and never counts refusals or exports", () => {
    const events = [
      ...repeat(BULK_DOWNLOAD_THRESHOLD - 1, { actorId: "busy" }),
      // Refusals are the probe rule's business, not volume.
      ...repeat(BULK_DOWNLOAD_THRESHOLD, { actorId: "busy", result: "refused" }),
      // Analytics exports are member-authed and bounded elsewhere.
      ...repeat(BULK_DOWNLOAD_THRESHOLD, {
        actorId: "busy",
        objectKind: "analytics_export",
      }),
    ];
    expect(detectBulkDownloads(ORG, events)).toHaveLength(0);
  });

  it("groups by actor kind too: a visitor and a member never pool", () => {
    const half = Math.ceil(BULK_DOWNLOAD_THRESHOLD / 2);
    const events = [
      ...repeat(half, { actorKind: "member", actorId: "x" }),
      ...repeat(half, { actorKind: "visitor", actorId: "x" }),
    ];
    expect(detectBulkDownloads(ORG, events)).toHaveLength(0);
  });
});

describe("detectRefusalProbes", () => {
  it("fires on one address collecting refusals", () => {
    const events = [
      ...repeat(REFUSAL_PROBE_THRESHOLD, { result: "refused", ip: "198.51.100.9" }),
      ...repeat(REFUSAL_PROBE_THRESHOLD - 1, { result: "refused", ip: "198.51.100.10" }),
    ];
    const findings = detectRefusalProbes(ORG, events);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "refusal-probe",
      subject: "198.51.100.9",
      count: REFUSAL_PROBE_THRESHOLD,
    });
  });

  it("never counts served or failed rows as probe evidence", () => {
    const events = [
      ...repeat(REFUSAL_PROBE_THRESHOLD, { result: "served" }),
      ...repeat(REFUSAL_PROBE_THRESHOLD, { result: "failed" }),
    ];
    expect(detectRefusalProbes(ORG, events)).toHaveLength(0);
  });
});

describe("detectNewAddressDownloads", () => {
  const baseline = repeat(NEW_ADDRESS_MIN_BASELINE, {
    actorId: "traveler",
    ip: "203.0.113.7",
  });

  it("fires when a known actor is served from an unseen address, once per pair", () => {
    const window = [
      ...repeat(3, { actorId: "traveler", ip: "198.51.100.9" }),
      event({ actorId: "traveler", ip: "203.0.113.7" }), // known address, quiet
    ];
    const findings = detectNewAddressDownloads(ORG, window, baseline);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "new-address",
      subject: "member:traveler@198.51.100.9",
    });
  });

  it("stays quiet for an actor with too little history", () => {
    const thin = repeat(NEW_ADDRESS_MIN_BASELINE - 1, {
      actorId: "newcomer",
      ip: "203.0.113.7",
    });
    const window = [event({ actorId: "newcomer", ip: "198.51.100.9" })];
    expect(detectNewAddressDownloads(ORG, window, thin)).toHaveLength(0);
    // And for an actor with no history at all.
    expect(detectNewAddressDownloads(ORG, window, [])).toHaveLength(0);
  });

  it("never reasons about visitors: their id is caller-supplied", () => {
    const visitorBaseline = repeat(NEW_ADDRESS_MIN_BASELINE, {
      actorKind: "visitor",
      actorId: "v-1",
      ip: "203.0.113.7",
    });
    const window = [
      event({ actorKind: "visitor", actorId: "v-1", ip: "198.51.100.9" }),
    ];
    expect(detectNewAddressDownloads(ORG, window, visitorBaseline)).toHaveLength(0);
  });
});

describe("runSecurityDetections", () => {
  function stubDb(overrides: Partial<Db>): Db {
    return {
      listOrganizations: vi.fn().mockResolvedValue([{ id: ORG, name: "Org" }]),
      listObjectAccessEvents: vi.fn().mockResolvedValue([]),
      raiseAlert: vi.fn().mockResolvedValue({}),
      ...overrides,
    } as unknown as Db;
  }

  it("turns findings into keyed, deduped Alerts and reads only the window", async () => {
    const raiseAlert = vi.fn().mockResolvedValue({});
    const listObjectAccessEvents = vi
      .fn()
      .mockResolvedValue(repeat(BULK_DOWNLOAD_THRESHOLD, { actorId: "downloader" }));
    const db = stubDb({ listObjectAccessEvents, raiseAlert });
    const now = new Date("2026-08-30T12:00:00.000Z");

    const report = await runSecurityDetections({ db }, { now });

    // One page, at the baseline horizon; the window split happens in code.
    expect(listObjectAccessEvents).toHaveBeenCalledTimes(1);
    expect(listObjectAccessEvents).toHaveBeenCalledWith(ORG, {
      sinceIso: "2026-07-31T12:00:00.000Z",
      limit: DETECTION_PAGE_SIZE,
      offset: 0,
    });
    expect(raiseAlert).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        type: "system",
        sourceKey: "security-detection:bulk-download:member:downloader",
      })
    );
    expect(report.detections).toMatchObject({ organizations: 1, findings: 1 });
  });

  it("pages past one read so the oldest baseline is not the first thing lost", async () => {
    // A tenant with more ledger rows in 30 days than one page holds. The
    // traveler's whole baseline sits on the *second* page; a single-page read
    // dropped it and flagged the known office address as new (#801 review,
    // CYB-19). The window rows come first because the read is newest-first.
    const windowRows = repeat(DETECTION_PAGE_SIZE, {
      actorId: "traveler",
      ip: "203.0.113.7",
      createdAt: "2026-08-30T06:00:00.000Z",
    });
    const baselineRows = repeat(NEW_ADDRESS_MIN_BASELINE, {
      actorId: "traveler",
      ip: "203.0.113.7",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    const listObjectAccessEvents = vi
      .fn()
      .mockResolvedValueOnce(windowRows)
      .mockResolvedValueOnce(baselineRows);
    const raiseAlert = vi.fn().mockResolvedValue({});
    const db = stubDb({ listObjectAccessEvents, raiseAlert });

    const report = await runSecurityDetections({ db }, { now: NOW });

    expect(listObjectAccessEvents).toHaveBeenCalledTimes(2);
    expect(listObjectAccessEvents).toHaveBeenLastCalledWith(ORG, {
      sinceIso: "2026-07-31T12:00:00.000Z",
      limit: DETECTION_PAGE_SIZE,
      offset: DETECTION_PAGE_SIZE,
    });
    // Bulk-download fires (5000 in a day is the point of the rule); the
    // new-address rule must not, because the address IS in the baseline.
    const rules = raiseAlert.mock.calls.map(
      ([, alert]) => (alert as { sourceKey: string }).sourceKey
    );
    expect(rules).toContain("security-detection:bulk-download:member:traveler");
    expect(rules.some((key) => key.startsWith("security-detection:new-address:"))).toBe(false);
    expect(report.detections.findings).toBe(1);
  });

  it("counts a row once when an insert mid-walk repeats it on the next page", async () => {
    // Newest-first offset paging over a live ledger: a download that lands
    // between page 1 and page 2 shifts every older row down by one, so the
    // last row of page 1 is also the first row of page 2. Without the id
    // dedup the bulk-download count included a download that never happened.
    const firstPage = repeat(DETECTION_PAGE_SIZE, { actorId: "downloader" });
    const secondPage = [
      firstPage[DETECTION_PAGE_SIZE - 1]!,
      event({ id: "e-new", actorId: "downloader" }),
    ];
    const listObjectAccessEvents = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const raiseAlert = vi.fn().mockResolvedValue({});
    const db = stubDb({ listObjectAccessEvents, raiseAlert });

    await runSecurityDetections({ db }, { now: NOW });

    expect(raiseAlert).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        sourceKey: "security-detection:bulk-download:member:downloader",
        detail: expect.stringContaining(
          `transferred ${DETECTION_PAGE_SIZE + 1} knowledge originals`
        ),
      })
    );
  });

  it("one organization failing never aborts the rest", async () => {
    const listOrganizations = vi
      .fn()
      .mockResolvedValue([{ id: "boom" }, { id: ORG }]);
    const listObjectAccessEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("ledger offline"))
      .mockResolvedValueOnce(repeat(REFUSAL_PROBE_THRESHOLD, { result: "refused" }));
    const db = stubDb({ listOrganizations, listObjectAccessEvents });

    const report = await runSecurityDetections({ db }, { now: NOW });

    expect(report.detections.results).toEqual(
      expect.arrayContaining([
        { organizationId: "boom", findings: 0, error: "ledger offline" },
        { organizationId: ORG, findings: 1 },
      ])
    );
  });

  it("an alert write failing is contained by signalHealth, the tick reports the finding", async () => {
    const raiseAlert = vi.fn().mockRejectedValue(new Error("alerts down"));
    const listObjectAccessEvents = vi
      .fn()
      .mockResolvedValue(repeat(BULK_DOWNLOAD_THRESHOLD, { actorId: "d" }));
    const db = stubDb({ listObjectAccessEvents, raiseAlert });

    const report = await runSecurityDetections({ db }, { now: NOW });

    expect(report.detections.findings).toBe(1);
  });
});
