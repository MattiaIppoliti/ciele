import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import {
  listApplicationConnectionsOp,
  listConnectorActionsOp,
  requestApplicationReconsentOp,
} from "./applications";
import type { OperationContext } from "./operation";

/**
 * The Applications domain over an API key (#839), on the fail-closed pinned
 * Db. Same purpose as `api-surface.test.ts`: the drift tests agree about names,
 * this is what proves the operations can actually run for a key.
 */

const pinned = (inner: Db = getMockDb()) => createOrgPinnedDb(inner, DEMO_ORG.id);

const keyContext = (db: Db): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "owner",
  db,
});

describe("the Applications domain over an API key", () => {
  it("runs every endpoint's operation on the pinned Db", async () => {
    const inner = getMockDb();
    const connection = await inner.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "slack",
      name: "Key Probe Slack",
      sealedCredentials: "sealed",
      scopes: ["channels:read"],
    });
    const ctx = keyContext(pinned(inner));

    const list = await listApplicationConnectionsOp.run(ctx, {});
    expect(list.map((row) => row.id)).toContain(connection.id);
    expect(list.every((row) => !("sealedCredentials" in row))).toBe(true);

    const catalogue = await listConnectorActionsOp.run(ctx, { provider: "slack" });
    expect(catalogue.map((row) => row.key)).toContain("slack.message.post");

    const reconsent = await requestApplicationReconsentOp.run(ctx, {
      id: connection.id,
      actions: ["slack.message.post"],
    });
    expect(reconsent.scopes).toEqual(["channels:read", "chat:write"]);
  });

  it("refuses another Organization's connection through the pinned view", async () => {
    const inner = getMockDb();
    const foreign = await inner.createApplicationConnection({
      organizationId: "some-other-org",
      provider: "slack",
      name: "Theirs",
      sealedCredentials: "sealed",
    });
    const ctx = keyContext(pinned(inner));
    await expect(
      requestApplicationReconsentOp.run(ctx, { id: foreign.id })
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await listApplicationConnectionsOp.run(ctx, {})).map((r) => r.id)).not.toContain(
      foreign.id
    );
  });
});
