import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// SSO cookies must be authenticated-encrypted; the helpers refuse to run
// without a key (see session.ts).
const priorKey = process.env.APP_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key";
});
afterAll(() => {
  if (priorKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = priorKey;
});

const mocks = vi.hoisted(() => ({
  getAssistant: vi.fn(),
  getSsoConnection: vi.fn(),
  getSsoProvider: vi.fn(),
}));

vi.mock("@/lib/widget-db", () => ({
  getWidgetDb: () => ({
    getAssistant: mocks.getAssistant,
    getSsoConnection: mocks.getSsoConnection,
  }),
}));

vi.mock("./index", () => ({
  getSsoProvider: mocks.getSsoProvider,
}));

import { handleSsoCallback, logoutSsoFlow, startSsoFlow } from "./handlers";
import { openGate, openTxn, sealTxn } from "./session";
import { SsoCallbackError } from "./types";

const ORG = "org-1";
const ASSISTANT = "assistant-1";
const AUTH_URL =
  "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize?x=1";

const connection = {
  id: "sso-1",
  organizationId: ORG,
  provider: "entra" as const,
  config: { clientId: "client-1", tenantId: "tenant-1" },
  encryptedSecret: "plain:the-secret",
  validationStatus: "valid" as const,
  validatedAt: null,
  connectedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const transient = {
  state: "state-1",
  nonce: "nonce-1",
  codeVerifier: "verifier-1",
  redirectUri: "https://platform.ciele.app/api/sso/entra/callback",
};

beforeEach(() => {
  mocks.getAssistant.mockReset().mockResolvedValue({
    id: ASSISTANT,
    organizationId: ORG,
  });
  mocks.getSsoConnection.mockReset().mockResolvedValue(connection);
  mocks.getSsoProvider.mockReset();
});

describe("startSsoFlow", () => {
  it("302s to the IdP and sets a sealed transient cookie", async () => {
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn().mockResolvedValue({
        authorizationUrl: AUTH_URL,
        transient,
      }),
      handleCallback: vi.fn(),
    });

    const req = new NextRequest(
      `https://platform.ciele.app/api/sso/entra/start?assistantId=${ASSISTANT}`
    );
    const res = await startSsoFlow(req, "entra");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(AUTH_URL);
    const txnCookie = res.cookies.get("sso_txn")?.value;
    const decoded = openTxn(txnCookie);
    expect(decoded).toMatchObject({
      assistantId: ASSISTANT,
      organizationId: ORG,
      provider: "entra",
      state: "state-1",
      redirectUri: transient.redirectUri,
    });
  });

  it("captures a same-origin returnTo but drops an off-origin one", async () => {
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn().mockResolvedValue({ authorizationUrl: AUTH_URL, transient }),
      handleCallback: vi.fn(),
    });
    const same = await startSsoFlow(
      new NextRequest(
        `https://platform.ciele.app/api/sso/entra/start?assistantId=${ASSISTANT}&returnTo=${encodeURIComponent("/widget/a1")}`
      ),
      "entra"
    );
    expect(openTxn(same.cookies.get("sso_txn")?.value)?.returnTo).toBe(
      "https://platform.ciele.app/widget/a1"
    );

    const evil = await startSsoFlow(
      new NextRequest(
        `https://platform.ciele.app/api/sso/entra/start?assistantId=${ASSISTANT}&returnTo=${encodeURIComponent("https://evil.example/x")}`
      ),
      "entra"
    );
    expect(openTxn(evil.cookies.get("sso_txn")?.value)?.returnTo).toBeUndefined();
  });

  it("404s when the assistant has no matching connection", async () => {
    mocks.getSsoConnection.mockResolvedValue(null);
    mocks.getSsoProvider.mockReturnValue({ kind: "entra", initiate: vi.fn(), handleCallback: vi.fn() });
    const req = new NextRequest(
      `https://platform.ciele.app/api/sso/entra/start?assistantId=${ASSISTANT}`
    );
    const res = await startSsoFlow(req, "entra");
    expect(res.status).toBe(404);
  });
});

describe("handleSsoCallback", () => {
  function callbackRequest(stateParam: string, returnTo?: string) {
    const txn = sealTxn({
      ...transient,
      assistantId: ASSISTANT,
      organizationId: ORG,
      provider: "entra",
      returnTo,
    });
    return new NextRequest(
      `https://platform.ciele.app/api/sso/entra/callback?code=auth-code&state=${stateParam}`,
      { headers: { cookie: `sso_txn=${txn}` } }
    );
  }

  it("mints a gate cookie and posts success on a valid callback", async () => {
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn(),
      handleCallback: vi.fn().mockResolvedValue({ subjectId: "sub-1" }),
    });

    const res = await handleSsoCallback(callbackRequest("state-1"), "entra");
    const html = await res.text();
    expect(html).toContain('"ciele-sso"');
    expect(html).toContain("ok: true");

    const gate = openGate(res.cookies.get("sso_gate")?.value);
    expect(gate).toMatchObject({
      organizationId: ORG,
      subjectId: "sub-1",
      provider: "entra",
    });
    // The transient is cleared.
    expect(res.cookies.get("sso_txn")?.value).toBe("");
  });

  it("mints the gate with the verified identity claim when configured (#662)", async () => {
    mocks.getSsoConnection.mockResolvedValue({
      ...connection,
      config: { ...connection.config, identityClaim: "email" },
    });
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn(),
      handleCallback: vi.fn().mockResolvedValue({
        subjectId: "sub-1",
        identityClaimValue: "person@example.com",
      }),
    });

    const res = await handleSsoCallback(callbackRequest("state-1"), "entra");
    const gate = openGate(res.cookies.get("sso_gate")?.value);
    expect(gate?.claim).toEqual({ name: "email", value: "person@example.com" });
  });

  it("mints a claim-free gate when the adapter returns no claim value", async () => {
    mocks.getSsoConnection.mockResolvedValue({
      ...connection,
      config: { ...connection.config, identityClaim: "email" },
    });
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn(),
      handleCallback: vi.fn().mockResolvedValue({ subjectId: "sub-1" }),
    });

    const res = await handleSsoCallback(callbackRequest("state-1"), "entra");
    const gate = openGate(res.cookies.get("sso_gate")?.value);
    expect(gate?.subjectId).toBe("sub-1");
    expect(gate?.claim).toBeUndefined();
  });

  it("redirects to returnTo in the top-level (no-opener) flow", async () => {
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn(),
      handleCallback: vi.fn().mockResolvedValue({ subjectId: "sub-1" }),
    });
    const res = await handleSsoCallback(
      callbackRequest("state-1", "https://platform.ciele.app/widget/a1"),
      "entra"
    );
    const html = await res.text();
    // The result page carries the returnTo for the no-opener branch.
    expect(html).toContain("https://platform.ciele.app/widget/a1");
    expect(html).toContain("window.location.replace");
    // Gate cookie still minted.
    expect(openGate(res.cookies.get("sso_gate")?.value)).toMatchObject({
      subjectId: "sub-1",
    });
  });

  it("posts failure and sets no gate cookie when the adapter rejects", async () => {
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn(),
      handleCallback: vi.fn().mockRejectedValue(new SsoCallbackError("bad token")),
    });

    const res = await handleSsoCallback(callbackRequest("state-1"), "entra");
    const html = await res.text();
    expect(html).toContain("ok: false");
    expect(res.cookies.get("sso_gate")?.value).toBeFalsy();
  });

  it("fails closed when the transient cookie is absent", async () => {
    mocks.getSsoProvider.mockReturnValue({
      kind: "entra",
      initiate: vi.fn(),
      handleCallback: vi.fn(),
    });
    const req = new NextRequest(
      "https://platform.ciele.app/api/sso/entra/callback?code=c&state=state-1"
    );
    const res = await handleSsoCallback(req, "entra");
    const html = await res.text();
    expect(html).toContain("ok: false");
    expect(res.cookies.get("sso_gate")?.value).toBeFalsy();
  });
});

describe("logoutSsoFlow", () => {
  it("clears the gate cookie and redirects to a same-origin returnTo", async () => {
    const req = new NextRequest(
      "https://platform.ciele.app/api/sso/entra/logout?returnTo=/widget/a1"
    );
    const res = await logoutSsoFlow(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://platform.ciele.app/widget/a1");
    expect(res.cookies.get("sso_gate")?.value).toBe("");
  });

  it("refuses an off-origin returnTo (no open redirect)", async () => {
    const req = new NextRequest(
      "https://platform.ciele.app/api/sso/entra/logout?returnTo=https://evil.example/steal"
    );
    const res = await logoutSsoFlow(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sso_gate")?.value).toBe("");
  });
});
