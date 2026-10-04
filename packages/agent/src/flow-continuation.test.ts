import { describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import { admitFlowContinuations, opaqueRequestDigest, restoreContinuationCredentials } from "./flow-continuation";

describe("frozen request arguments and current credentials", () => {
  it("retains no opaque values, detects their edits, and rotates typed auth without replacing arguments", async () => {
    resetMockDb();
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Checkpoint" });
    const flow = await db.createFlow(assistant.id, { name: "Request", actions: ["human_review", "api_request"], actionSettings: { api_request: { auth: { type: "bearer", token: "original-secret" }, queryParams: [{ id: "one", name: "courseId", value: "101" }, { id: "two", name: "courseId", value: "102" }], headers: [{ id: "header", name: "arbitrary-credential", value: "opaque-secret" }] } } });
    const factory = await admitFlowContinuations({ db, assistant, skills: [], originRequestId: "origin", conversationId: "conversation" });
    const checkpoint = factory("review", { flow, variables: {}, message: "Original" });
    expect(JSON.stringify(checkpoint)).not.toContain("original-secret");
    expect(JSON.stringify(checkpoint)).not.toContain("opaque-secret");
    expect(JSON.stringify(checkpoint)).not.toContain('"101"');
    const rotated = { ...flow, actionSettings: { ...flow.actionSettings, api_request: { ...flow.actionSettings.api_request, auth: { type: "bearer" as const, token: "current-secret" } } } };
    expect(opaqueRequestDigest(checkpoint.snapshot.flow, rotated, checkpoint.gateId)).toBe(checkpoint.snapshot.opaqueRequestDigest);
    const resumed = restoreContinuationCredentials(checkpoint.snapshot.flow, rotated);
    expect(resumed.actionSettings.api_request?.auth).toEqual({ type: "bearer", token: "current-secret" });
    expect(resumed.actionSettings.api_request?.queryParams).toEqual([{ id: "one", name: "courseId", value: "101" }, { id: "two", name: "courseId", value: "102" }]);
    const edited = { ...rotated, actionSettings: { ...rotated.actionSettings, api_request: { ...rotated.actionSettings.api_request, queryParams: [{ id: "one", name: "courseId", value: "202" }] } } };
    expect(opaqueRequestDigest(checkpoint.snapshot.flow, edited, checkpoint.gateId)).not.toBe(checkpoint.snapshot.opaqueRequestDigest);
  });
});
