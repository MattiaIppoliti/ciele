import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));
const cookieMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => cookieMocks }));
// Keep the real SSO helpers (SSO_GATE_COOKIE, isGateValidForOrg, sealGate);
// only stub the provider registry.
const ssoMocks = vi.hoisted(() => ({ getSsoProvider: vi.fn() }));
vi.mock("@/lib/sso", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/sso")>()),
  getSsoProvider: ssoMocks.getSsoProvider,
}));

import { requireMember } from "@/lib/authz";
import { sealGate } from "@/lib/sso";
import {
  disconnectSsoConnectionAction,
  getPreviewSsoGateAction,
  setAssistantRequireSignInAction,
  setSsoConnectionAction,
  validateSsoConnectionAction,
} from "./actions";

const priorKey = process.env.APP_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key";
});
afterAll(() => {
  if (priorKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = priorKey;
});

describe("SSO connection actions", () => {
  const requireMemberMock = vi.mocked(requireMember);
  let db: Db;
  const assistantId = "assistant-x";

  beforeEach(async () => {
    db = getMockDb();
    // The mock store is a module singleton; the SSO connection is org-keyed, so
    // clear it between tests to avoid cross-test leakage.
    await db.clearSsoConnection(DEMO_ORG.id);
    cookieMocks.get.mockReset();
    requireMemberMock.mockReset();
    ssoMocks.getSsoProvider.mockReset();
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: { organization: DEMO_ORG, userId: "user-1" },
    } as never);
  });

  it("connects: seals the secret and stores non-secret config (admin capability)", async () => {
    const result = await setSsoConnectionAction(assistantId, {
      provider: "entra",
      clientId: "client-1",
      tenantId: "tenant-1",
      clientSecret: "super-secret",
    });
    expect(result).toEqual({});
    expect(requireMemberMock).toHaveBeenCalledWith("manageMembers");

    const stored = await db.getSsoConnection(DEMO_ORG.id);
    expect(stored?.config).toEqual({ clientId: "client-1", tenantId: "tenant-1" });
    // Secret is sealed (transformed), never stored as the raw value.
    expect(stored?.encryptedSecret).toBeTruthy();
    expect(stored?.encryptedSecret).not.toBe("super-secret");
    expect(stored?.validationStatus).toBe("unvalidated");
  });

  it("connects: rejects missing fields without writing", async () => {
    const result = await setSsoConnectionAction(assistantId, {
      provider: "entra",
      clientId: "",
      tenantId: "tenant-1",
      clientSecret: "s",
    });
    expect(result.error).toBeTruthy();
    expect(await db.getSsoConnection(DEMO_ORG.id)).toBeNull();
  });

  it("connects: rejects a not-yet-available provider", async () => {
    const result = await setSsoConnectionAction(assistantId, {
      provider: "clerk",
      clientId: "a",
      tenantId: "b",
      clientSecret: "c",
    });
    expect(result.error).toBeTruthy();
    expect(await db.getSsoConnection(DEMO_ORG.id)).toBeNull();
  });

  it("validates: records the provider result as the validation status", async () => {
    await setSsoConnectionAction(assistantId, {
      provider: "entra",
      clientId: "client-1",
      tenantId: "tenant-1",
      clientSecret: "super-secret",
    });
    ssoMocks.getSsoProvider.mockReturnValue({
      validate: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await validateSsoConnectionAction(assistantId);
    expect(result).toEqual({ ok: true });
    expect((await db.getSsoConnection(DEMO_ORG.id))?.validationStatus).toBe("valid");
  });

  it("validates: surfaces the failure reason and marks invalid", async () => {
    await setSsoConnectionAction(assistantId, {
      provider: "entra",
      clientId: "client-1",
      tenantId: "tenant-1",
      clientSecret: "wrong",
    });
    ssoMocks.getSsoProvider.mockReturnValue({
      validate: vi.fn().mockResolvedValue({ ok: false, error: "AADSTS7000215" }),
    });

    const result = await validateSsoConnectionAction(assistantId);
    expect(result).toEqual({ ok: false, error: "AADSTS7000215" });
    expect((await db.getSsoConnection(DEMO_ORG.id))?.validationStatus).toBe("invalid");
  });

  it("validates: fails cleanly when there is no connection", async () => {
    const result = await validateSsoConnectionAction(assistantId);
    expect(result.ok).toBe(false);
  });

  it("disconnects: removes the connection", async () => {
    await setSsoConnectionAction(assistantId, {
      provider: "entra",
      clientId: "client-1",
      tenantId: "tenant-1",
      clientSecret: "super-secret",
    });
    await disconnectSsoConnectionAction(assistantId);
    expect(await db.getSsoConnection(DEMO_ORG.id)).toBeNull();
  });

  it("toggles require-sign-in on the assistant (edit capability)", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    await setAssistantRequireSignInAction(assistant.id, true);
    expect(requireMemberMock).toHaveBeenCalledWith("edit");
    expect((await db.getAssistant(assistant.id))?.requireSignIn).toBe(true);
  });

  describe("getPreviewSsoGateAction (live gate state for the editor preview)", () => {
    it("reports no gate when the assistant doesn't require sign-in", async () => {
      const a = await db.createAssistant(DEMO_ORG.id, { title: "Open" });
      expect(await getPreviewSsoGateAction(a.id)).toEqual({
        requireSignIn: false,
        authenticated: true,
        provider: null,
      });
    });

    it("is gated (unauthenticated) with the branded provider when enforced and no cookie", async () => {
      const a = await db.createAssistant(DEMO_ORG.id, { title: "Gated" });
      await db.updateAssistant(a.id, { requireSignIn: true });
      await setSsoConnectionAction(a.id, {
        provider: "entra",
        clientId: "c",
        tenantId: "t",
        clientSecret: "s",
      });
      cookieMocks.get.mockReturnValue(undefined); // no gate cookie

      expect(await getPreviewSsoGateAction(a.id)).toEqual({
        requireSignIn: true,
        authenticated: false,
        provider: "entra",
      });
    });

    it("is authenticated when a valid gate cookie for the org is present", async () => {
      const a = await db.createAssistant(DEMO_ORG.id, { title: "Gated" });
      await db.updateAssistant(a.id, { requireSignIn: true });
      await setSsoConnectionAction(a.id, {
        provider: "entra",
        clientId: "c",
        tenantId: "t",
        clientSecret: "s",
      });
      const gate = sealGate({
        organizationId: DEMO_ORG.id,
        subjectId: "visitor-1",
        provider: "entra",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      cookieMocks.get.mockReturnValue({ value: gate });

      const result = await getPreviewSsoGateAction(a.id);
      expect(result.authenticated).toBe(true);
    });
  });
});
