import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { ensureCieleAiOp, updateTeammateOp } from "@ciele/ops";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session, profileName: () => "Test Member" }));
vi.mock("@/lib/data", async () => { const { getMockDb } = await import("@agent-hub/db"); return { getDb: () => getMockDb() }; });
vi.mock("@/lib/runtime-db", () => ({ getRuntimeDb: (db: unknown) => db }));
vi.mock("@/lib/personal-subscription", () => ({ resolvePersonalSubscription: () => ({ providers: [], runner: undefined }) }));
vi.mock("@/lib/teammates/actions", () => ({ resolveTeammateActions: () => [] }));
vi.mock("@/lib/platform", () => ({ listPlatformEvalModels: () => [] }));
vi.mock("@agent-hub/agent", async (original) => ({ ...await original<typeof import("@agent-hub/agent")>(), streamConversationTurn: mocks.stream }));

import { POST } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Ciele AI default model routing", () => {
  it("reads the saved organization default for the next message without a selector", async () => {
    const db = getMockDb();
    const ctx = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner" as const };
    const builtin = await ensureCieleAiOp.run(ctx, {});
    await updateTeammateOp.run(ctx, { id: builtin.id, patch: { modelProvider: "google", modelId: "gemini-3.5-flash-lite" } });
    mocks.session.mockResolvedValue({ userId: DEMO_MEMBER.userId, organization: DEMO_ORG, role: "owner", email: "qa@example.com", profile: null });
    mocks.stream.mockResolvedValue(new ReadableStream());
    const response = await POST(new NextRequest("http://localhost/api/teammates/builtin/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Synthetic default route check" }) }), { params: Promise.resolve({ teammateId: builtin.id }) });
    expect(response.status).toBe(200);
    expect(mocks.stream.mock.calls[0][0].teammate).toMatchObject({ id: builtin.id, organizationId: DEMO_ORG.id, systemKind: "ciele_ai", modelProvider: "google", modelId: "gemini-3.5-flash-lite" });
    mocks.session.mockResolvedValue({ userId: DEMO_MEMBER.userId, organization: { ...DEMO_ORG, id: "another-org" }, role: "owner" });
    const denied = await POST(new NextRequest("http://localhost/api/teammates/builtin/chat", { method: "POST", body: JSON.stringify({ message: "Synthetic foreign tenant check" }) }), { params: Promise.resolve({ teammateId: builtin.id }) });
    expect(denied.status).toBe(404);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });
});


it("Auto selects the sole eligible evaluated model after a default loses its credential", async () => {
  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "AI_GATEWAY_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"]) vi.stubEnv(key, undefined);
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-google");
  const db = getMockDb();
  const ctx = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner" as const };
  const builtin = await ensureCieleAiOp.run(ctx, {});
  const candidate = { provider: "google" as const, modelId: "gemini-3.5-flash" };
  await updateTeammateOp.run(ctx, { id: builtin.id, patch: {
    modelProvider: "anthropic", modelId: "claude-sonnet-5", allowedModels: [candidate],
  } });
  const run = await db.table("evaluationRuns").insert({
    organizationId: DEMO_ORG.id, assistantId: "a", assistantName: "A",
    assistantModel: candidate, datasetId: "d", datasetName: "D",
    examples: [{ id: "e1", inputs: { question: "q" }, reference_outputs: {} }],
    stage: "answer", candidates: [candidate],
  });
  await db.table("evaluationRuns").update(run.id, { status: "completed", results: [{
    exampleId: "e1", candidate, answer: "Answer", flowId: null, flowName: null,
    sourceUrls: [], latencyMs: 10, inputTokens: 1, outputTokens: 1,
    costEur: 0, accuracy: true, autonomous: null, error: null,
  }] });
  mocks.session.mockResolvedValue({ userId: DEMO_MEMBER.userId, organization: DEMO_ORG, role: "owner", email: "qa@example.com", profile: null });
  mocks.stream.mockResolvedValue(new ReadableStream());
  await POST(new NextRequest("http://localhost/api/teammates/builtin/chat", {
    method: "POST", body: JSON.stringify({ message: "Which answer?", model: "auto" }),
  }), { params: Promise.resolve({ teammateId: builtin.id }) });
  expect(mocks.stream.mock.calls[0][0].teammate).toMatchObject({
    modelProvider: candidate.provider, modelId: candidate.modelId,
  });
});
