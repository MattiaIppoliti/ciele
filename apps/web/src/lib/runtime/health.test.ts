import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import { alertKeys, signalHealth } from "./health";

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
