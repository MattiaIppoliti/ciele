import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  listApplicationConnectionsOp,
  listConnectorActionsOp,
  reconsentScopes,
  reconsentStartPath,
  requestApplicationReconsentOp,
} from "./applications";
import { OperationError, type OperationContext } from "./operation";

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "owner" as Role,
  db: getMockDb(),
  ...over,
});

async function seedSlack(db = getMockDb(), scopes = ["channels:read"]) {
  return db.createApplicationConnection({
    organizationId: DEMO_ORG.id,
    provider: "slack",
    name: "Slack",
    sealedCredentials: "sealed",
    scopes,
  });
}

describe("applications operations", () => {
  it("declares the catalogue contract", () => {
    expect(listApplicationConnectionsOp.capability).toBe("member");
    expect(requestApplicationReconsentOp.capability).toBe("publish");
    expect(listConnectorActionsOp.capability).toBe("member");
  });

  it("lists connections without the sealed credential, filtered by provider", async () => {
    const db = getMockDb();
    await seedSlack(db);
    const rows = await listApplicationConnectionsOp.run(ctx({ db }), { provider: "slack" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.provider).toBe("slack");
      expect("sealedCredentials" in row).toBe(false);
    }
  });

  it("hides another Member's personal connection from an Editor", async () => {
    const db = getMockDb();
    await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "onedrive",
      ownerMemberId: "someone-else",
      name: "Their OneDrive",
      sealedCredentials: "sealed",
    });
    const asEditor = await listApplicationConnectionsOp.run(
      ctx({ db, role: "editor" as Role }),
      { provider: "onedrive" }
    );
    expect(asEditor.some((row) => row.name === "Their OneDrive")).toBe(false);
    const asOwner = await listApplicationConnectionsOp.run(ctx({ db }), { provider: "onedrive" });
    expect(asOwner.some((row) => row.name === "Their OneDrive")).toBe(true);
  });

  it("re-consent unions the held scopes with what the named actions need", () => {
    const union = reconsentScopes(
      { provider: "slack", scopes: ["channels:read"] },
      ["slack.message.post", "slack.channel.join"],
      ["users:read"]
    );
    expect(union).toEqual(["channels:read", "chat:write", "channels:join", "users:read"]);
    expect(() =>
      reconsentScopes({ provider: "slack", scopes: [] }, ["servicenow.record.create"])
    ).toThrow(OperationError);
    expect(() => reconsentScopes({ provider: "slack", scopes: [] }, ["nope.nope.nope"])).toThrow(
      /Unknown connector action/
    );
  });

  it("returns the start path the caller opens, with the union in the query", async () => {
    const db = getMockDb();
    const connection = await seedSlack(db);
    const result = await requestApplicationReconsentOp.run(ctx({ db }), {
      id: connection.id,
      actions: ["slack.message.post"],
    });
    expect(result.scopes).toEqual(["channels:read", "chat:write"]);
    expect(result.startPath).toBe(
      reconsentStartPath(connection, ["channels:read", "chat:write"])
    );
    expect(result.startPath).toMatch(/^\/api\/applications\/oauth\/slack\/start\?connectionId=/);
    expect(new URL(result.startPath, "https://x.test").searchParams.get("scopes")).toBe(
      "channels:read chat:write"
    );
  });

  it("refuses another Organization's connection", async () => {
    const db = getMockDb();
    const connection = await seedSlack(db);
    await expect(
      requestApplicationReconsentOp.run(ctx({ db, organizationId: "other" }), {
        id: connection.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("describes the catalogue without runtime detail", async () => {
    const actions = await listConnectorActionsOp.run(ctx(), { provider: "servicenow" });
    expect(actions.map((a) => a.key)).toContain("servicenow.record.create");
    expect(actions.every((a) => a.provider === "servicenow")).toBe(true);
    expect(actions[0]!.fields[0]).toMatchObject({ name: "table", required: true });
  });
});
