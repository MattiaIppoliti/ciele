import { describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb } from "./index";
import {
  danglingScopeAlertKey,
  raiseDanglingCollectionAlert,
  resolveDanglingCollectionAlerts,
} from "./teammate-scope";

/**
 * The dangling-Collection Alert (#769).
 *
 * A Teammate's Knowledge Scope is a list of ids, deliberately not a foreign key
 * (an empty scope is valid, and a delete must not silently rewrite somebody's
 * configuration). The price of that choice is that a deleted Collection can
 * leave a Teammate searching something that is gone, so the operational surface
 * has to say so. These are the two halves: raise on the delete, resolve once
 * nobody references it any more.
 */

const db = getMockDb();

async function teammate(name: string, collectionIds: string[]) {
  return db.table("teammates").insert({
    organizationId: DEMO_ORG.id,
    ownerId: "member-1",
    name,
    collectionIds,
  });
}

/** Source keys of this org's currently-active Alerts. */
const activeKeys = async () =>
  (await db.listAlerts(DEMO_ORG.id))
    .filter((alert) => alert.status === "active")
    .map((alert) => alert.sourceKey);

/** The mock store is shared across cases, so every case names its own ids. */
let seq = 0;
const collectionId = () => `col-gone-${++seq}`;

describe("raiseDanglingCollectionAlert", () => {
  it("says nothing when no Teammate was searching the deleted Collection", async () => {
    const gone = collectionId();
    await teammate("Nora", ["col-kept"]);
    await raiseDanglingCollectionAlert(db, DEMO_ORG.id, gone, "Gone");
    expect(await activeKeys()).not.toContain(danglingScopeAlertKey(gone));
  });

  it("raises one Alert naming every Teammate that still searches it", async () => {
    const gone = collectionId();
    await teammate("Nora", [gone, "col-kept"]);
    await teammate("Sam", [gone]);
    await teammate("Ada", ["col-kept"]);

    await raiseDanglingCollectionAlert(db, DEMO_ORG.id, gone, "Refunds");

    const raised = (await db.listAlerts(DEMO_ORG.id)).filter(
      (alert) =>
        alert.status === "active" &&
        alert.sourceKey === danglingScopeAlertKey(gone)
    );
    // One Alert for the Collection, not one per Teammate: the thing that broke
    // is the Collection, and an admin fixing it wants one row to work from.
    expect(raised).toHaveLength(1);
    expect(raised[0].type).toBe("knowledge");
    expect(raised[0].title).toContain("Refunds");
    expect(raised[0].detail).toContain("Nora");
    expect(raised[0].detail).toContain("Sam");
    expect(raised[0].detail).not.toContain("Ada");
  });

  it("ignores a retired Teammate: it searches nothing any more", async () => {
    const gone = collectionId();
    const retired = await teammate("Retired", [gone]);
    await db
      .table("teammates")
      .update(retired.id, { deletedAt: new Date().toISOString() });

    await raiseDanglingCollectionAlert(db, DEMO_ORG.id, gone, "Gone");
    expect(await activeKeys()).not.toContain(danglingScopeAlertKey(gone));
  });

  it("stays inside the Organization that lost the Collection", async () => {
    const gone = collectionId();
    await teammate("Nora", [gone]);
    await raiseDanglingCollectionAlert(db, "another-org", gone, "Gone");
    expect(await activeKeys()).not.toContain(danglingScopeAlertKey(gone));
  });
});

describe("resolveDanglingCollectionAlerts", () => {
  it("resolves the Alert once the last Teammate drops the id", async () => {
    const gone = collectionId();
    const nora = await teammate("Nora", [gone]);
    await raiseDanglingCollectionAlert(db, DEMO_ORG.id, gone, "Refunds");
    expect(await activeKeys()).toContain(danglingScopeAlertKey(gone));

    await db.table("teammates").update(nora.id, { collectionIds: [] });
    await resolveDanglingCollectionAlerts(db, DEMO_ORG.id, [gone]);

    expect(await activeKeys()).not.toContain(danglingScopeAlertKey(gone));
    // Resolved, not deleted: the Alerts page keeps the history.
    const resolved = (await db.listAlerts(DEMO_ORG.id)).filter(
      (alert) => alert.status === "resolved"
    );
    expect(resolved.map((alert) => alert.sourceKey)).toContain(
      danglingScopeAlertKey(gone)
    );
  });

  it("keeps the Alert while another Teammate still names the Collection", async () => {
    const gone = collectionId();
    const nora = await teammate("Nora", [gone]);
    await teammate("Sam", [gone]);
    await raiseDanglingCollectionAlert(db, DEMO_ORG.id, gone, "Refunds");

    await db.table("teammates").update(nora.id, { collectionIds: [] });
    await resolveDanglingCollectionAlerts(db, DEMO_ORG.id, [gone]);

    // Sam is still pointed at nothing, so the problem is not fixed.
    expect(await activeKeys()).toContain(danglingScopeAlertKey(gone));
  });

  it("resolves when the last Teammate holding the id is retired", async () => {
    const gone = collectionId();
    const nora = await teammate("Nora", [gone]);
    await raiseDanglingCollectionAlert(db, DEMO_ORG.id, gone, "Refunds");

    await db
      .table("teammates")
      .update(nora.id, { deletedAt: new Date().toISOString() });
    await resolveDanglingCollectionAlerts(db, DEMO_ORG.id, [gone]);

    expect(await activeKeys()).not.toContain(danglingScopeAlertKey(gone));
  });

  it("does nothing for a Collection that still exists", async () => {
    // A scope edit hands over every id it touched, including live ones. Those
    // never had an Alert, and asking to resolve one must not invent history.
    const collection = await db.createCollection(
      (await db.listAssistants(DEMO_ORG.id))[0].id,
      { name: "Live" }
    );
    await teammate("Nora", [collection.id]);
    const before = (await db.listAlerts(DEMO_ORG.id)).length;
    await resolveDanglingCollectionAlerts(db, DEMO_ORG.id, [collection.id]);
    expect((await db.listAlerts(DEMO_ORG.id)).length).toBe(before);
  });
});
