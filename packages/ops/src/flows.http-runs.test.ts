import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import { listHttpFlowRunsOp } from "./flows";
import type { OperationContext } from "./operation";

const ctx = (db = getMockDb(), over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db,
  ...over,
});

/**
 * The inbound run record (#843): a run is not a Conversation, so its history
 * is read from the Flow, and only by a Member of the Organization that owns it.
 */
describe("flows.http.runs", () => {
  it("lists the latest runs of one Flow, newest first, and only to its own Organization", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Endpoint" });
    const flow = await db.createFlow(assistant.id, {
      name: "Order status",
      trigger: "http_request",
      actions: ["respond"],
      actionSettings: { respond: { status: 200 } },
    });
    const record = (status: number, failedAction: string | null) =>
      db.table("httpFlowRuns").insert({
        organizationId: DEMO_ORG.id,
        assistantId: assistant.id,
        flowId: flow.id,
        publicationId: null,
        method: "POST",
        status,
        ran: failedAction ? ["api_request"] : ["api_request", "respond"],
        failedAction,
        failedMessage: failedAction ? "boom" : null,
        durationMs: 12,
      });
    await record(200, null);
    await new Promise((resolve) => setTimeout(resolve, 3));
    await record(500, "api_request");

    const runs = await listHttpFlowRunsOp.run(ctx(db), { flowId: flow.id, limit: 20 });
    expect(runs.map((run) => run.status)).toEqual([500, 200]);
    expect(runs[0]).toMatchObject({ failedAction: "api_request", failedMessage: "boom" });

    await expect(
      listHttpFlowRunsOp.run(ctx(db, { organizationId: "other-org" }), { flowId: flow.id, limit: 20 })
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      listHttpFlowRunsOp.run(ctx(db), { flowId: "nope", limit: 20 })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
