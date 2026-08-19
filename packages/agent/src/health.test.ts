import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { alertKeys, recordProviderHealth, signalHealth } from "./health";

/**
 * The keyed health-signal seam: unhealthy raises (deduped by sourceKey),
 * healthy auto-resolves, and alert bookkeeping failures never escape to the
 * producer that reported the signal.
 */

function makeDb() {
  return {
    raiseAlert: vi.fn(async () => ({})),
    resolveAlertsByKey: vi.fn(async () => {}),
  } as unknown as Db;
}

describe("signalHealth", () => {
  it("raises the alert with the key as sourceKey when unhealthy", async () => {
    const db = makeDb();
    await signalHealth(db, "org-1", {
      key: alertKeys.goal("g1"),
      healthy: false,
      alert: { type: "system", title: "Goal failing", detail: "detail" },
    });
    expect(db.raiseAlert).toHaveBeenCalledWith("org-1", {
      type: "system",
      title: "Goal failing",
      detail: "detail",
      sourceKey: "goal:g1",
    });
    expect(db.resolveAlertsByKey).not.toHaveBeenCalled();
  });

  it("auto-resolves by key when healthy", async () => {
    const db = makeDb();
    await signalHealth(db, "org-1", {
      key: alertKeys.embedding("a1"),
      healthy: true,
    });
    expect(db.resolveAlertsByKey).toHaveBeenCalledWith("org-1", "embedding:a1");
    expect(db.raiseAlert).not.toHaveBeenCalled();
  });

  it("swallows bookkeeping failures (alerting never breaks the producer)", async () => {
    const db = makeDb();
    vi.mocked(db.raiseAlert).mockRejectedValue(new Error("db down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await expect(
      signalHealth(
        db,
        "org-1",
        {
          key: alertKeys.budget("org-1"),
          healthy: false,
          alert: { type: "system", title: "t", detail: "d" },
        },
        "budget"
      )
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("alertKeys pins the persisted sourceKey formats", () => {
    expect(alertKeys.embedding("a")).toBe("embedding:a");
    expect(alertKeys.websiteSource("s")).toBe("website-source:s");
    expect(alertKeys.ingestSource("s")).toBe("ingest-source:s");
    expect(alertKeys.provider("google", "google_vertex_federated")).toBe(
      "provider:google:google_vertex_federated"
    );
    expect(alertKeys.budget("o")).toBe("budget:o");
    expect(alertKeys.flowTrust("f")).toBe("flow-trust:f");
    expect(alertKeys.goal("g")).toBe("goal:g");
  });
});

describe("recordProviderHealth", () => {
  it("raises, deduplicates, and auto-resolves federated provider alerts", async () => {
    const db = getMockDb();
    await recordProviderHealth({
      db,
      organizationId: DEMO_ORG.id,
      assistantTitle: "Campus AI",
      event: {
        provider: "google",
        credentialKind: "google_vertex_federated",
        ok: false,
        detail: "invalid_grant",
      },
    });
    await recordProviderHealth({
      db,
      organizationId: DEMO_ORG.id,
      assistantTitle: "Campus AI",
      event: {
        provider: "google",
        credentialKind: "google_vertex_federated",
        ok: false,
        detail: "quota exceeded",
      },
    });

    const sourceKey = "provider:google:google_vertex_federated";
    const active = (await db.listAlerts(DEMO_ORG.id)).filter(
      (a) => a.sourceKey === sourceKey && a.status === "active"
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      type: "provider",
      title: "Google Vertex federated auth failed",
    });
    expect(active[0].detail).toContain("quota exceeded");

    await recordProviderHealth({
      db,
      organizationId: DEMO_ORG.id,
      assistantTitle: "Campus AI",
      event: {
        provider: "google",
        credentialKind: "google_vertex_federated",
        ok: true,
      },
    });
    const after = (await db.listAlerts(DEMO_ORG.id)).filter(
      (a) => a.sourceKey === sourceKey && a.status === "active"
    );
    expect(after).toHaveLength(0);
  });
});
