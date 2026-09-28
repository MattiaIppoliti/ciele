import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSecret, type Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { OperationError } from "./operation";
import { setOrgBudgetOp } from "./organization";
import { configureEntitySyncOp } from "./data";

/**
 * Two Settings mutations that kept their rules in a server action until they
 * became operations: the daily AI budget and an Entity's sync source.
 */

const ctx = (organizationId = DEMO_ORG.id): OperationContext => ({
  organizationId,
  userId: DEMO_MEMBER.userId,
  role: "admin" as Role,
  db: getMockDb(),
});

describe("setOrgBudgetOp", () => {
  it("stores whole tokens and euros to the cent", async () => {
    const input = setOrgBudgetOp.input.parse({
      dailyTokenLimit: 1500.7,
      dailyEuroLimit: 12.345,
      enforcement: "block",
    });
    const budget = await setOrgBudgetOp.run(ctx(), input);
    expect(budget).toMatchObject({
      dailyTokenLimit: 1500,
      dailyEuroLimit: 12.35,
      enforcement: "block",
    });
  });

  it("lets either limit be absent and refuses one that is not positive", () => {
    expect(
      setOrgBudgetOp.input.safeParse({
        dailyTokenLimit: null,
        dailyEuroLimit: null,
        enforcement: "notify",
      }).success,
    ).toBe(true);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const parsed = setOrgBudgetOp.input.safeParse({
        dailyTokenLimit: bad,
        dailyEuroLimit: null,
        enforcement: "notify",
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(
        "The daily token limit must be a positive number.",
      );
    }
    expect(
      setOrgBudgetOp.input.safeParse({
        dailyTokenLimit: null,
        dailyEuroLimit: null,
        enforcement: "sometimes",
      }).success,
    ).toBe(false);
  });

  it("is an admin's setting", () => {
    expect(setOrgBudgetOp.capability).toBe("manageMembers");
  });
});

describe("configureEntitySyncOp", () => {
  beforeEach(() => vi.stubEnv("APP_ENCRYPTION_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  async function entity(organizationId = DEMO_ORG.id) {
    return getMockDb().table("entities").insert({
      organizationId,
      name: "Orders",
      description: "",
      attributes: [{ key: "order_id", label: "Order ID", type: "text" }],
      keyAttribute: "order_id",
      scope: "shared",
      identityAttribute: null,
    });
  }

  const base = {
    url: "https://erp.example/orders",
    headers: [] as { name: string; value: string }[],
    cadenceHours: 6,
    prune: false,
    mapping: { order_id: "id" },
  };

  it("seals the headers and keeps them when a later save sends none", async () => {
    const { id } = await entity();
    await configureEntitySyncOp.run(ctx(), {
      ...base,
      entityId: id,
      headers: [
        { name: "Authorization", value: "Bearer secret-token" },
        { name: "  ", value: "dropped" },
      ],
    });
    const sealed = (await getMockDb().getEntitySyncConfig(id))?.sealedHeaders;
    expect(sealed).not.toContain("secret-token");
    expect(JSON.parse(openSecret(sealed!))).toEqual([
      { name: "Authorization", value: "Bearer secret-token" },
    ]);

    const kept = await configureEntitySyncOp.run(ctx(), { ...base, entityId: id, cadenceHours: 12 });
    expect(kept.sealedHeaders).toBe(sealed);
    expect(kept.cadenceHours).toBe(12);

    const cleared = await configureEntitySyncOp.run(ctx(), {
      ...base,
      entityId: id,
      clearHeaders: true,
    });
    expect(cleared.sealedHeaders).toBeNull();
  });

  it("syncs at most hourly, in whole hours, daily when unset", async () => {
    const { id } = await entity();
    const run = (cadenceHours: number) =>
      configureEntitySyncOp.run(ctx(), { ...base, entityId: id, cadenceHours });
    expect((await run(0.2)).cadenceHours).toBe(1);
    expect((await run(5.9)).cadenceHours).toBe(5);
    expect((await run(0)).cadenceHours).toBe(24);
  });

  it("refuses a source that is not an http(s) URL, and another Organization's Entity", async () => {
    const { id } = await entity();
    await expect(
      configureEntitySyncOp.run(ctx(), { ...base, entityId: id, url: "not a url" }),
    ).rejects.toMatchObject({ code: "invalid_input", message: "Enter a valid URL." });
    await expect(
      configureEntitySyncOp.run(ctx(), { ...base, entityId: id, url: "ftp://erp.example/x" }),
    ).rejects.toMatchObject({ message: "The sync source must be an http(s) URL." });
    const foreign = await entity("org_other");
    await expect(
      configureEntitySyncOp.run(ctx(), { ...base, entityId: foreign.id }),
    ).rejects.toBeInstanceOf(OperationError);
    expect(await getMockDb().getEntitySyncConfig(foreign.id)).toBeNull();
  });
});
