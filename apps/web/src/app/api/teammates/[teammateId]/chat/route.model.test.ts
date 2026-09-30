import { describe, expect, it, vi } from "vitest";
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
