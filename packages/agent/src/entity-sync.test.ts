import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "@agent-hub/core";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";
import { enqueueEntitySyncJob, runDueEntitySyncJobs } from "./jobs";
import { ENTITY_SYNC_MAX_ROWS, mapSyncRows, runEntitySync } from "./entity-sync";

/**
 * Synced Record ingestion (#670), tested through the job-registry seam with
 * the HTTP fetch faked (per the spec's testing decisions): happy path,
 * per-row rejection, prune mode, and Alert raise / auto-resolve. The mock
 * Db provides the real upsert/prune/report/alert behavior — assertions are
 * on external state, never call order.
 */

// runEntitySync takes an injected fetcher, but the job handler (registry
// path) builds the default one — mock the egress boundary for that path.
const egress = vi.hoisted(() => ({ egressFetch: vi.fn() }));
vi.mock("./egress", () => ({
  egressFetch: egress.egressFetch,
  EgressPolicyError: class extends Error {},
}));

let db: Db;
let entity: Entity;

async function configure(overrides: Partial<Parameters<Db["upsertEntitySyncConfig"]>[1]> = {}) {
  await db.upsertEntitySyncConfig(entity.id, {
    url: "https://api.example.com/orders",
    sealedHeaders: null,
    cadenceHours: 24,
    prune: false,
    mapping: {},
    ...overrides,
  });
}

function respondWith(payload: unknown, status = 200) {
  egress.egressFetch.mockResolvedValue({
    response: { ok: status < 400, status, text: JSON.stringify(payload) },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = getMockDb();
  entity = await db.table("entities").insert({
    organizationId: DEMO_ORG.id,
    name: "Orders",
    description: "Customer orders",
    attributes: [
      { key: "order_id", label: "Order ID", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "total", label: "Total", type: "number" },
    ],
    keyAttribute: "order_id",
    scope: "shared",
    identityAttribute: null,
  });
});

async function drain() {
  return runDueEntitySyncJobs({ db }, { workerId: "test-worker" });
}

describe("sync_entity_records through the registry seam", () => {
  it("fetches, maps, upserts idempotently and records the run report", async () => {
    await configure();
    respondWith([
      { order_id: "A-1", status: "shipped", total: 10 },
      { order_id: "A-2", status: "delayed", total: "not-a-number" },
    ]);
    await enqueueEntitySyncJob({ entityId: entity.id, organizationId: DEMO_ORG.id }, { db });

    const result = await drain();
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });

    const records = await db.listEntityRecords(entity.id);
    expect(records.map((r) => r.key)).toEqual(["A-1"]);
    const [run] = await db.listEntitySyncRuns(entity.id);
    expect(run).toMatchObject({ status: "succeeded", upserted: 1, pruned: 0 });
    expect(run.rejected[0]).toContain("total is not a number");
    expect((await db.getEntitySyncConfig(entity.id))?.lastSyncedAt).toBeTruthy();

    // Re-running the same payload upserts by key — no duplicates.
    respondWith([{ order_id: "A-1", status: "refunded", total: 10 }]);
    await enqueueEntitySyncJob(
      { entityId: entity.id, organizationId: DEMO_ORG.id, force: true },
      { db }
    );
    await drain();
    const after = await db.listEntityRecords(entity.id);
    expect(after).toHaveLength(1);
    expect(after[0].values.status).toBe("refunded");
  });

  it("prune mode removes Records unseen in the run — only when enabled", async () => {
    await configure({ prune: true });
    await db.upsertEntityRecords(entity.id, [
      { key: "OLD", values: { order_id: "OLD", status: "gone", total: 0 } },
    ]);
    respondWith([{ order_id: "A-1", status: "open", total: 5 }]);
    await enqueueEntitySyncJob(
      { entityId: entity.id, organizationId: DEMO_ORG.id, force: true },
      { db }
    );
    await drain();
    expect((await db.listEntityRecords(entity.id)).map((r) => r.key)).toEqual(["A-1"]);
    const [run] = await db.listEntitySyncRuns(entity.id);
    expect(run.pruned).toBe(1);
  });

  it("keeps unseen Records when prune is off", async () => {
    await configure({ prune: false });
    await db.upsertEntityRecords(entity.id, [
      { key: "OLD", values: { order_id: "OLD", status: "kept", total: 0 } },
    ]);
    respondWith([{ order_id: "A-1", status: "open", total: 5 }]);
    await enqueueEntitySyncJob(
      { entityId: entity.id, organizationId: DEMO_ORG.id, force: true },
      { db }
    );
    await drain();
    const keys = (await db.listEntityRecords(entity.id)).map((r) => r.key).sort();
    expect(keys).toEqual(["A-1", "OLD"]);
  });

  it("a failing fetch records a failed run, raises an Alert, and retries via the ledger", async () => {
    await configure();
    respondWith({ error: "nope" }, 500);
    await enqueueEntitySyncJob(
      { entityId: entity.id, organizationId: DEMO_ORG.id, force: true },
      { db }
    );
    const result = await drain();
    expect(result).toMatchObject({ claimed: 1, retried: 1 });

    const [run] = await db.listEntitySyncRuns(entity.id);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("500");
    const alerts = await db.listAlerts(DEMO_ORG.id);
    const alert = alerts.find((a) => a.sourceKey === `entity-sync:${entity.id}`);
    expect(alert?.status).toBe("active");

    // A later successful run auto-resolves the alert.
    respondWith([{ order_id: "A-1", status: "open", total: 5 }]);
    await runEntitySync({
      db,
      entityId: entity.id,
      organizationId: DEMO_ORG.id,
      force: true,
      fetcher: async () => [{ order_id: "A-1", status: "open", total: 5 }],
    });
    const resolved = (await db.listAlerts(DEMO_ORG.id)).find(
      (a) => a.sourceKey === `entity-sync:${entity.id}`
    );
    expect(resolved?.status).toBe("resolved");
  });

  it("no-ops a duplicate sweep enqueue inside the cadence window", async () => {
    await configure();
    await db.markEntitySynced(entity.id, new Date().toISOString());
    await enqueueEntitySyncJob({ entityId: entity.id, organizationId: DEMO_ORG.id }, { db });
    const result = await drain();
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(egress.egressFetch).not.toHaveBeenCalled();
    expect(await db.listEntitySyncRuns(entity.id)).toHaveLength(0);
  });
});

describe("mapSyncRows", () => {
  it("maps fields via the configured mapping and rejects rows individually", () => {
    const { rows, rejected } = mapSyncRows(
      [
        { orderNumber: "A-1", status: "open", total: 5 },
        { orderNumber: "", status: "open", total: 5 },
        { orderNumber: "A-1", status: "dupe", total: 5 },
      ],
      entity,
      { orderNumber: "order_id" }
    );
    expect(rows).toEqual([
      { key: "A-1", values: { order_id: "A-1", status: "open", total: 5 } },
    ]);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toContain("missing key attribute");
    expect(rejected[1]).toContain("duplicate key");
  });

  it("caps a runaway source at the row limit with an honest report", () => {
    const raw = Array.from({ length: ENTITY_SYNC_MAX_ROWS + 1 }, (_, i) => ({
      order_id: `K-${i}`,
      status: "open",
      total: i,
    }));
    const { rows, rejected } = mapSyncRows(raw, entity, {});
    expect(rows).toHaveLength(ENTITY_SYNC_MAX_ROWS);
    expect(rejected.at(-1)).toContain("only the first");
  });
});
