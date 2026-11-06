import { updateImprovementOp, improvementPatchSchema } from "./improvements";
import { describe, expect, it } from "vitest";
import { DEMO_ORG, DEMO_MEMBER, getMockDb } from "@agent-hub/db";
import { buildPublicationConfig } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { listImprovementValidationsOp, recordImprovementValidationOp, requestImprovementReplayOp } from "./improvement-validation";
const db = getMockDb();
const ctx: OperationContext = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner" };
describe("Improvement validation operations", () => {
  it("records manual evidence without resolving the Improvement", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Validation fixture" });
    const improvement = await db.createImprovement(DEMO_ORG.id, { title: "Answer gap" });
    const record = await recordImprovementValidationOp.run(ctx, { improvementId: improvement.id, assistantId: assistant.id, expectedBehavior: "Cites the shipping policy", changedResources: "Shipping FAQ", detail: "Checked the customer widget", result: "pass" });
    expect(record.validatorId).toBe(ctx.userId);
    expect(record.kind).toBe("manual");
    expect((await db.getImprovement(improvement.id))?.status).toBe("to_do");
  });
  it("refuses a foreign Improvement before recording a result", async () => {
    const improvement = await db.createImprovement(DEMO_ORG.id, { title: "Private gap" });
    await expect(recordImprovementValidationOp.run({ ...ctx, organizationId: "foreign" }, { improvementId: improvement.id, assistantId: "missing", expectedBehavior: "Expected", changedResources: "FAQ", detail: "Checked", result: "pass" })).rejects.toThrow("Improvement not found");
  });
  it("refuses machines asserting human widget verification", async () => {
    await expect(recordImprovementValidationOp.run({ ...ctx, teammate: { id: "tm", name: "Nora", grants: ["improvements"], ceiling: "edit", approvalBypass: false } }, { improvementId: "missing", assistantId: "missing", expectedBehavior: "Expected", changedResources: "FAQ", detail: "Checked", result: "pass" })).rejects.toThrow("Member");
  });
  it("marks historical evidence stale after publication changes", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Versioned validation" });
    const item = await db.createImprovement(DEMO_ORG.id, { title: "Versioned gap" });
    await recordImprovementValidationOp.run(ctx, { improvementId: item.id, assistantId: assistant.id, expectedBehavior: "Correct", changedResources: "FAQ", detail: "Checked widget", result: "pass" });
    await db.createPublication(assistant.id, buildPublicationConfig(assistant, [], []));
    const view = await listImprovementValidationsOp.run(ctx, { improvementId: item.id });
    expect(view.records[0]?.stale).toBe(true);
    expect(view.records[0]?.status).toBe("pass");
  });
  it("queues one replay against the latest Publication and refuses a second while it is pending", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Replay request" });
    const publication = await db.createPublication(assistant.id, buildPublicationConfig(assistant, [], []));
    const item = await db.createImprovement(DEMO_ORG.id, { title: "Replay gap" });
    const queued: string[] = [];
    const withPort: OperationContext = { ...ctx, ports: { enqueueImprovementReplay: async (id) => { queued.push(id); } } };
    const input = { improvementId: item.id, assistantId: assistant.id, expectedBehavior: "Correct", changedResources: "FAQ", cases: [{ question: "Question", expectations: { mustContain: ["Answer"] } }] };
    const run = await requestImprovementReplayOp.run(withPort, input);
    expect(run).toMatchObject({ kind: "replay", status: "pending", publicationId: publication.id, validatorId: ctx.userId });
    expect(queued).toEqual([run.id]);
    await expect(requestImprovementReplayOp.run(withPort, input)).rejects.toThrow("already pending");
    await expect(requestImprovementReplayOp.run({ ...withPort, apiKeyId: "key" }, input)).rejects.toThrow("Member");
  });
  it("requires explicit replay expectations and caps the request at three cases", () => {
    expect(requestImprovementReplayOp.input.safeParse({ improvementId: "item", assistantId: "assistant", expectedBehavior: "Correct", changedResources: "FAQ", cases: Array.from({ length: 4 }, () => ({ question: "Question", expectations: { mustContain: ["Answer"] } })) }).success).toBe(false);
  });

  it("refuses assignments and Projects outside the Organization", async () => {
    const item = await db.createImprovement(DEMO_ORG.id, { title: "Assignment gap" });
    await expect(updateImprovementOp.run(ctx, { id: item.id, patch: { assigneeId: "foreign-member" } })).rejects.toThrow("Organization");
    const project = await db.table("projects").insert({ organizationId: "foreign", name: "Foreign", description: "", key: "FRGN" });
    await expect(updateImprovementOp.run(ctx, { id: item.id, patch: { projectId: project.id } })).rejects.toThrow("Project");
    expect(improvementPatchSchema.safeParse({ status: "verified" }).success).toBe(false);
  });

});
