import { describe, expect, it } from "vitest";
import { DEMO_ORG, DEMO_MEMBER, getMockDb } from "@agent-hub/db";
import { buildPublicationConfig, type ImprovementValidation } from "@agent-hub/core";
import { runDueJobs } from "./jobs";
const db = getMockDb();
async function queuedReplay(cases: ImprovementValidation["cases"] = [{ question: "shipping cost", expectations: { mustContain: ["free"] } }]) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Replay fixture" });
  await db.createFlow(assistant.id, { name: "Shipping", description: "shipping cost", actions: ["custom_message"], customMessage: "Shipping is free." });
  const publication = await db.createPublication(assistant.id, buildPublicationConfig(assistant, await db.listFlows(assistant.id), []));
  const item = await db.createImprovement(DEMO_ORG.id, { title: "Shipping answer" });
  const run = await db.createImprovementValidation(DEMO_ORG.id, { improvementId: item.id, assistantId: assistant.id, validatorId: DEMO_MEMBER.userId, kind: "replay", status: "pending", publicationId: publication.id, snapshot: await db.getAssistantValidationSnapshot(assistant.id), expectedBehavior: "States free shipping", changedResources: "Shipping FAQ", detail: "Queued", cases, results: [], completedAt: null });
  return { assistant, item, run };
}
describe("Improvement replay jobs", () => {
  it("records a published answer without resolving the Improvement or creating Visitor traffic", async () => {
    const { run, item, assistant } = await queuedReplay();
    await runDueJobs({ db }, { kinds: ["replay_improvement"], limit: 1 });
    const result = await db.table("improvementValidations").get(run.id);
    expect(result?.status).toBe("pass");
    expect(result?.results[0]?.answer).toContain("free");
    expect((await db.getImprovement(item.id))?.status).toBe("to_do");
    expect((await db.getInboxPage(DEMO_ORG.id, { assistantId: assistant.id })).conversations).toEqual([]);
  });
  it("refuses stale inputs before spending or producing a passing result", async () => {
    const { run, assistant } = await queuedReplay();
    await db.createPublication(assistant.id, buildPublicationConfig(assistant, [], []));
    await runDueJobs({ db }, { kinds: ["replay_improvement"], limit: 1 });
    const result = await db.table("improvementValidations").get(run.id);
    expect(result?.status).toBe("error");
    expect(result?.detail).toContain("changed");
    expect(result?.results).toEqual([]);
  });
  it("retains passing and failing cases and checks citations independently", async () => {
    const { run } = await queuedReplay([
      { question: "shipping cost", expectations: { mustContain: ["free"] } },
      { question: "shipping cost", expectations: { mustContain: ["free"], mustCiteSources: true } },
    ]);
    await runDueJobs({ db }, { kinds: ["replay_improvement"], limit: 1 });
    const result = await db.table("improvementValidations").get(run.id);
    expect(result?.status).toBe("fail");
    expect(result?.results.map((row) => row.pass)).toEqual([true, false]);
    expect(result?.results[1]?.detail).toContain("no Sources");
  });
  it("refuses oversized direct-storage requests before executing any case", async () => {
    const { run } = await queuedReplay(Array.from({ length: 4 }, () => ({ question: "shipping cost", expectations: { mustContain: ["free"] } })));
    await runDueJobs({ db }, { kinds: ["replay_improvement"], limit: 1 });
    const result = await db.table("improvementValidations").get(run.id);
    expect(result?.status).toBe("error");
    expect(result?.results).toEqual([]);
  });

});
