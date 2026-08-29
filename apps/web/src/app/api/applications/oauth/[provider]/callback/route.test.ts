import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(),
  getWidgetDb: vi.fn(),
  exchange: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/data", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/widget-db", () => ({ getWidgetDb: mocks.getWidgetDb }));
vi.mock("@/lib/application-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/application-oauth")>()),
  exchangeApplicationOAuthCode: mocks.exchange,
}));

import {
  newApplicationOAuthTransaction,
  sealApplicationOAuthTransaction,
} from "@/lib/application-oauth";
import { GET } from "./route";

describe("Application OAuth callback route", () => {
  const createConnection = vi.fn();
  const consumeNonce = vi.fn();

  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "oauth-callback-test-key");
    mocks.getSession.mockReset();
    mocks.getDb.mockReset();
    mocks.getWidgetDb.mockReset();
    mocks.exchange.mockReset();
    createConnection.mockReset();
    consumeNonce.mockReset().mockResolvedValue(true);
    mocks.getSession.mockResolvedValue({
      userId: "member-1",
      organization: { id: "org-1" },
      role: "owner",
    });
    mocks.getDb.mockResolvedValue({
      getSafeApplicationConnection: vi.fn(),
      consumeApplicationOAuthNonce: consumeNonce,
    });
    mocks.getWidgetDb.mockReturnValue({
      createApplicationConnection: createConnection,
      updateApplicationConnection: vi.fn(),
    });
    mocks.exchange.mockResolvedValue({
      credentials: { accessToken: "provider-access-token" },
      name: "Acme Salesforce",
      providerAccountId: "tenant-1",
      scopes: ["api"],
      metadata: {},
    });
  });

  function request(memberId = "member-1") {
    const redirectUri =
      "https://ciele.example/api/applications/oauth/salesforce/callback";
    const transaction = newApplicationOAuthTransaction({
      provider: "salesforce",
      organizationId: "org-1",
      memberId,
      returnTo: "/library/applications",
      redirectUri,
      providerSettings: {
        connectionName: "Admissions Salesforce",
        loginUrl: "https://login.salesforce.com",
        clientId: "organization-client",
        clientSecret: "organization-secret",
      },
    });
    const cookie = sealApplicationOAuthTransaction(transaction);
    return new NextRequest(`${redirectUri}?code=code&state=${transaction.nonce}`, {
      headers: { cookie: `application_oauth_txn=${cookie}` },
    });
  }

  it("rejects a callback replayed by another member", async () => {
    const response = await GET(request("member-2"), {
      params: Promise.resolve({ provider: "salesforce" }),
    });
    expect(response.status).toBe(403);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("owns a personal Drive connection by the authorizing Member", async () => {
    const redirectUri =
      "https://ciele.example/api/applications/oauth/google_drive/callback";
    const transaction = newApplicationOAuthTransaction({
      provider: "google_drive",
      organizationId: "org-1",
      memberId: "member-1",
      returnTo: "/library/applications",
      redirectUri,
    });
    const cookie = sealApplicationOAuthTransaction(transaction);
    const response = await GET(
      new NextRequest(
        `${redirectUri}?code=code&state=${transaction.nonce}`,
        { headers: { cookie: `application_oauth_txn=${cookie}` } }
      ),
      { params: Promise.resolve({ provider: "google_drive" }) }
    );
    expect(response.status).toBe(200);
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        ownerMemberId: "member-1",
        provider: "google_drive",
      })
    );
  });

  it("seals the connection, clears state, and notifies only the opener origin", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ provider: "salesforce" }),
    });
    expect(response.status).toBe(200);
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        provider: "salesforce",
        sealedCredentials: expect.not.stringContaining("provider-access-token"),
      })
    );
    const body = await response.text();
    expect(body).toContain("window.opener.postMessage");
    expect(body).toContain("window.location.origin");
    expect(response.headers.get("set-cookie")).toContain(
      "application_oauth_txn=;"
    );
  });

  it("rejects a replay after the nonce has already been consumed", async () => {
    consumeNonce.mockResolvedValue(false);
    const response = await GET(request(), {
      params: Promise.resolve({ provider: "salesforce" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(createConnection).not.toHaveBeenCalled();
  });
});
