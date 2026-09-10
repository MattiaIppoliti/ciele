import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import { createFlowOp } from "./flows";
import { OperationError, type OperationContext } from "./operation";
import { publishAssistantOp } from "./publish";

/**
 * Publish refuses a Flow whose Connector action the widget could not run
 * (#839): no connection, a personal one, missing scopes. The reason names the
 * Flow, so the console shows it where the Editor can act on it.
 */

const ctx = (db = getMockDb()): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "owner" as Role,
  db,
});

async function assistantWithConnector(
  db: ReturnType<typeof getMockDb>,
  connectionId: string
) {
  const assistant = await createAssistantOp.run(ctx(db), { title: "Connector probe" });
  await createFlowOp.run(ctx(db), {
    assistantId: assistant.id,
    input: {
      name: "Post to Slack",
      trigger: "message",
      actions: ["connector"],
      actionSettings: {
        connector: {
          provider: "slack",
          connectionId,
          action: "slack.message.post",
          params: { channel: "C1", text: "hi" },
        },
      },
    },
  });
  return assistant;
}

describe("publishing Flows with a Connector action", () => {
  it("refuses a Connector whose connection no longer exists", async () => {
    const db = getMockDb();
    const assistant = await assistantWithConnector(db, "missing-connection");
    await expect(
      publishAssistantOp.run(ctx(db), { assistantId: assistant.id })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      publishAssistantOp.run(ctx(db), { assistantId: assistant.id })
    ).rejects.toThrow(/Flow "Post to Slack": The connection no longer exists/);
  });

  it("refuses a Drive connector: personal connections run only on operator surfaces (#840)", async () => {
    const db = getMockDb();
    const personal = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "onedrive",
      ownerMemberId: DEMO_MEMBER.userId,
      name: "My OneDrive",
      sealedCredentials: "sealed",
      scopes: ["Files.ReadWrite"],
    });
    const assistant = await createAssistantOp.run(ctx(db), { title: "Drive probe" });
    await createFlowOp.run(ctx(db), {
      assistantId: assistant.id,
      input: {
        name: "Save to OneDrive",
        trigger: "message",
        actions: ["connector"],
        actionSettings: {
          connector: {
            provider: "onedrive",
            connectionId: personal.id,
            action: "onedrive.file.create",
            params: { name: "x.txt", content: "hi" },
          },
        },
      },
    });
    await expect(
      publishAssistantOp.run(ctx(db), { assistantId: assistant.id })
    ).rejects.toThrow(
      /Flow "Save to OneDrive": Drive connectors run only in Preview and Teammate chat/
    );
  });

  it("refuses a connection that lacks the action's scopes", async () => {
    const db = getMockDb();
    const connection = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "slack",
      name: "Slack",
      sealedCredentials: "sealed",
      scopes: ["channels:read"],
    });
    const assistant = await assistantWithConnector(db, connection.id);
    await expect(
      publishAssistantOp.run(ctx(db), { assistantId: assistant.id })
    ).rejects.toThrow(/lacks the scopes: chat:write/);
  });

  it("publishes once the connection holds what the action needs", async () => {
    const db = getMockDb();
    const connection = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "slack",
      name: "Slack",
      sealedCredentials: "sealed",
      scopes: ["channels:read", "chat:write"],
    });
    const assistant = await assistantWithConnector(db, connection.id);
    const result = await publishAssistantOp.run(ctx(db), { assistantId: assistant.id });
    expect(result.version).toBeGreaterThan(0);
    // The snapshot names the connection and nothing more: no credential.
    const publication = await db.getLatestPublication(assistant.id);
    const frozen = publication?.config.flows.find((flow) => flow.name === "Post to Slack");
    expect(frozen?.actionSettings?.connector).toEqual({
      provider: "slack",
      connectionId: connection.id,
      action: "slack.message.post",
      params: { channel: "C1", text: "hi" },
    });
    expect(JSON.stringify(publication?.config)).not.toContain("sealed");
  });

  it("refuses an unconfigured Connector before publishing", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Half done" });
    await createFlowOp.run(ctx(db), {
      assistantId: assistant.id,
      input: {
        name: "Half",
        trigger: "message",
        actions: ["connector"],
        actionSettings: { connector: { provider: "slack" } },
      },
    });
    const error = await publishAssistantOp
      .run(ctx(db), { assistantId: assistant.id })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OperationError);
    expect((error as Error).message).toMatch(/choose a connector action before publishing/);
  });
});
