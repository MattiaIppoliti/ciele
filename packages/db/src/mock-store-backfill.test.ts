import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockDb } from "./mock";

/**
 * The mock store is stashed on `globalThis` so it survives Next.js dev-server
 * HMR. That makes a warm store a *stale shape*: a field added to `MockStore`
 * after the store was created is simply absent, and the first read of it throws
 * on the dev server while the test suite, which always builds a fresh store,
 * stays green.
 *
 * `getStore` therefore backfills missing fields from a fresh empty store shape.
 * These tests hold that invariant for *every* declared field, not just the ones
 * someone remembered to list, by simulating the warm store: create it, delete
 * one field, and assert the next `Db` call refills it instead of throwing.
 */

type WarmGlobal = { __agentHubMock?: Record<string, unknown> };

const globalForMock = globalThis as unknown as WarmGlobal;

/** Force store creation and hand back the stashed object. */
async function warmStore(): Promise<Record<string, unknown>> {
  globalForMock.__agentHubMock = undefined;
  await mockDb.getCurrentOrg();
  const store = globalForMock.__agentHubMock;
  if (!store) throw new Error("expected the mock store to be stashed globally");
  return store;
}

/** A `Db` read that goes through `getStore` but asserts nothing about shape. */
const touchStore = () => mockDb.getCurrentOrg();

afterEach(() => {
  globalForMock.__agentHubMock = undefined;
});

describe("mock store HMR backfill", () => {
  let fields: string[];

  beforeEach(async () => {
    fields = Object.keys(await warmStore());
  });

  it("declares fields to guard", () => {
    // A guard over an empty list would pass vacuously forever.
    expect(fields.length).toBeGreaterThan(20);
  });

  it("refills any single field a warm store predates", async () => {
    for (const field of fields) {
      const store = await warmStore();
      delete store[field];

      await expect(
        touchStore(),
        `reading the store with '${field}' missing threw`
      ).resolves.toBeTruthy();

      expect(
        globalForMock.__agentHubMock?.[field],
        `'${field}' was not backfilled, a dev server holding a warm store ` +
          `from before it was added will throw on first read`
      ).toBeDefined();
    }
  });

  it("refills a field without resetting the fields around it", async () => {
    const store = await warmStore();
    const assistants = store.assistants as Map<string, unknown>;
    const seeded = assistants.size;
    expect(seeded).toBeGreaterThan(0);

    delete store.publications;
    await touchStore();

    expect(globalForMock.__agentHubMock?.publications).toBeInstanceOf(Map);
    expect((store.assistants as Map<string, unknown>).size).toBe(seeded);
  });

  it("backfills in place rather than swapping the stashed store", async () => {
    const store = await warmStore();
    delete store.publications;
    await touchStore();

    // Callers that captured the store (or a map off it) before the backfill
    // must see the same object afterwards.
    expect(globalForMock.__agentHubMock).toBe(store);
  });
});
