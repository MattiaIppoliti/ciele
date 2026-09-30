import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";
import type { EvaluationStage } from "@agent-hub/core";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireMember: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/platform", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/platform")>(), listPlatformEvalModels: vi.fn(async () => []) }));
vi.mock("@/lib/evaluation-models", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/evaluation-models")>(),
  availableEvaluationModels: vi.fn(() => [
    { provider: "google", modelId: "gemini-3.5-flash", label: "Gemini", providerName: "Google" },
    { provider: "openai", modelId: "gpt-5.1", label: "GPT", providerName: "OpenAI" },
    { provider: "voyage", modelId: "voyage/rerank-2.5-lite", label: "Rerank", providerName: "Voyage" },
  ]),
}));
import { createTeammateOp } from "@ciele/ops";
import { requireMember } from "@/lib/authz";
import { evaluationDefaultContextAction, saveEvaluationDefaultAction, saveTeammateDefaultModelAction } from "./actions";

describe("Eval defaults actions", () => {
  let db: Db;
  beforeEach(() => {
    db = getMockDb();
    vi.mocked(requireMember).mockReset();
    vi.mocked(requireMember).mockResolvedValue({ db, organizationId: DEMO_ORG.id, session: { organization: DEMO_ORG, userId: "model-admin", role: "admin" } } as never);
  });
  it("saves the answer default and keeps tools and other stage defaults", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Eval default" });
    await db.updateAssistant(assistant.id, { tools: { builtIns: { searchKnowledge: false }, evaluationModels: { reranker: { provider: "voyage", modelId: "voyage/rerank-2.5-lite" } } } });
    const model = { provider: "google", modelId: "gemini-3.5-flash" };
    expect(await saveEvaluationDefaultAction({ assistantId: assistant.id, stage: "answer", model })).toEqual({ ok: true });
    expect(requireMember).toHaveBeenCalledWith("edit");
    expect(await db.getAssistant(assistant.id)).toMatchObject({ modelProvider: "google", modelId: model.modelId, modelSource: null, tools: { builtIns: { searchKnowledge: false }, evaluationModels: { answer: model, reranker: { provider: "voyage" } } } });
    expect((await evaluationDefaultContextAction(assistant.id, "answer")).current).toEqual(model);
  });
  it("persists each stage and replaces the shared routing choice", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Stages" });
    for (const stage of ["classifier", "orchestration", "fallback", "preflight", "reranker"] satisfies EvaluationStage[]) {
      const model = stage === "reranker" ? { provider: "voyage", modelId: "voyage/rerank-2.5-lite" } : { provider: "openai", modelId: "gpt-5.1" };
      expect(await saveEvaluationDefaultAction({ assistantId: assistant.id, stage, model })).toEqual({ ok: true });
      expect((await db.getAssistant(assistant.id))?.tools.evaluationModels?.[stage]).toEqual(model);
    }
    expect((await db.getAssistant(assistant.id))?.tools.evaluationModels?.classifier).toBeUndefined();
  });
  it("rejects foreign Assistants, unavailable models and wrong-stage providers", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Scope" });
    for (const model of [{ provider: "openai", modelId: "unavailable" }, { provider: "voyage", modelId: "voyage/rerank-2.5-lite" }])
      expect(await saveEvaluationDefaultAction({ assistantId: assistant.id, stage: "answer", model })).toMatchObject({ ok: false });
    vi.mocked(requireMember).mockResolvedValue({ db, organizationId: "foreign" } as never);
    expect(await saveEvaluationDefaultAction({ assistantId: assistant.id, stage: "answer", model: { provider: "google", modelId: "gemini-3.5-flash" } })).toMatchObject({ ok: false });
    await expect(evaluationDefaultContextAction(assistant.id, "answer")).rejects.toThrow("Assistant not found");
  });
  it("reads the latest completed run only for the selected Assistant and stage", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Evidence" });
    const other = await db.createAssistant(DEMO_ORG.id, { title: "Other" });
    const dataset = await db.table("evaluationDatasets").insert({ organizationId: DEMO_ORG.id, name: "Evidence", examples: [] });
    const runs = db.table("evaluationRuns");
    async function create(assistantId: string, stage: EvaluationStage, completed = true) {
      const run = await runs.insert({ organizationId: DEMO_ORG.id, assistantId, assistantName: "Evidence", assistantModel: { provider: "google", modelId: "gemini-3.5-flash" }, datasetId: dataset.id, datasetName: dataset.name, examples: [], candidates: [], stage });
      return completed ? runs.update(run.id, { status: "completed", results: [] }) : run;
    }
    const expected = await create(assistant.id, "answer");
    await create(other.id, "answer");
    await create(assistant.id, "classifier");
    await create(assistant.id, "answer", false);
    const context = await evaluationDefaultContextAction(assistant.id, "answer");
    expect(context.run?.id).toBe(expected.id);
    expect(context.recentRuns).toHaveLength(2);
    expect(context.recentRuns.every(run => run.assistantId === assistant.id && run.stage === "answer")).toBe(true);
  });

  it("does not mutate when the editor permission is denied", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Read only" });
    vi.mocked(requireMember).mockRejectedValue(new Error("Permission denied"));
    expect(await saveEvaluationDefaultAction({ assistantId: assistant.id, stage: "answer", model: { provider: "google", modelId: "gemini-3.5-flash" } })).toMatchObject({ ok: false, error: "Permission denied" });
    expect((await db.getAssistant(assistant.id))?.tools.evaluationModels).toBeUndefined();
  });
  it("saves a Teammate default without changing its persona or allowed models", async () => {
    const teammate = await createTeammateOp.run({ db, organizationId: DEMO_ORG.id, userId: "model-admin", role: "admin" }, { name: "Default test" });
    expect(teammate).toBeDefined();
    const model = { provider: "google", modelId: "gemini-3.5-flash" };
    expect(await saveTeammateDefaultModelAction({ teammateId: teammate.id, model })).toEqual({ ok: true });
    expect(await db.table("teammates").get(teammate.id)).toMatchObject({ ...teammate, updatedAt: expect.any(String), modelProvider: model.provider, modelId: model.modelId, modelSource: null });
  });
  it("rejects foreign, retired, unavailable and unauthorized Teammate defaults", async () => {
    const teammate = await createTeammateOp.run({ db, organizationId: DEMO_ORG.id, userId: "model-admin", role: "admin" }, { name: "Default test" });
    const original = await db.table("teammates").get(teammate.id);
    const input = { teammateId: teammate.id, model: { provider: "google", modelId: "gemini-3.5-flash" } };
    expect(await saveTeammateDefaultModelAction({ ...input, model: { provider: "google", modelId: "unavailable" } })).toMatchObject({ ok: false });
    expect(await saveTeammateDefaultModelAction({ ...input, model: { provider: "voyage", modelId: "voyage/rerank-2.5-lite" } })).toMatchObject({ ok: false });
    vi.mocked(requireMember).mockResolvedValue({ db, organizationId: "foreign", session: { userId: "model-admin", role: "admin" } } as never);
    expect(await saveTeammateDefaultModelAction(input)).toMatchObject({ ok: false });
    vi.mocked(requireMember).mockResolvedValue({ db, organizationId: DEMO_ORG.id, session: { userId: "stranger", role: "editor" } } as never);
    expect(await saveTeammateDefaultModelAction(input)).toMatchObject({ ok: false });
    expect(await db.table("teammates").get(teammate.id)).toEqual(original);
    vi.mocked(requireMember).mockResolvedValue({ db, organizationId: DEMO_ORG.id, session: { userId: "model-admin", role: "admin" } } as never);
    await db.table("teammates").update(teammate.id, { deletedAt: new Date().toISOString() });
    expect(await saveTeammateDefaultModelAction(input)).toMatchObject({ ok: false });
  });

});
