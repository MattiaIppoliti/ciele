import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/data", () => ({ getDb: mocks.getDb }));

import { POST } from "./route";

function session(role: "owner" | "editor" = "owner") {
  return {
    userId: "member-1",
    organization: { id: "org-1" },
    role,
  };
}

describe("Application OAuth start route", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "oauth-route-test-key");
    vi.stubEnv("MICROSOFT_APPLICATION_CLIENT_ID", "microsoft-client");
    vi.stubEnv("MICROSOFT_APPLICATION_CLIENT_SECRET", "microsoft-secret");
    mocks.getSession.mockReset();
    mocks.getDb.mockReset();
    mocks.getSession.mockResolvedValue(session());
    mocks.getDb.mockResolvedValue({
      getSafeApplicationConnection: vi.fn().mockResolvedValue(null),
      createApplicationOAuthNonce: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("restricts broad provider authorization to Admins and Owners", async () => {
    mocks.getSession.mockResolvedValue(session("editor"));
    const response = await POST(
      new NextRequest(
        "https://ciele.example/api/applications/oauth/salesforce/start",
        {
          method: "POST",
          body: JSON.stringify({ returnTo: "/library/applications" }),
          headers: { "content-type": "application/json" },
        }
      ),
      { params: Promise.resolve({ provider: "salesforce" }) }
    );
    expect(response.status).toBe(403);
  });

  it("lets an Editor authorize their personal OneDrive", async () => {
    mocks.getSession.mockResolvedValue(session("editor"));
    const response = await POST(
      new NextRequest(
        "https://ciele.example/api/applications/oauth/onedrive/start",
        {
          method: "POST",
          body: JSON.stringify({ returnTo: "/library/applications" }),
          headers: { "content-type": "application/json" },
        }
      ),
      { params: Promise.resolve({ provider: "onedrive" }) }
    );
    expect(response.status).toBe(200);
  });

  it("returns an authorization URL and stores only a sealed HttpOnly transaction", async () => {
    const response = await POST(
      new NextRequest(
        "https://ciele.example/api/applications/oauth/salesforce/start",
        {
          method: "POST",
          body: JSON.stringify({
            returnTo: "/library/applications",
            connectionName: "Admissions Salesforce",
            loginUrl: "https://login.salesforce.com",
            clientId: "organization-client",
            clientSecret: "organization-secret",
          }),
          headers: { "content-type": "application/json" },
        }
      ),
      { params: Promise.resolve({ provider: "salesforce" }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorizationUrl: string };
    expect(body.authorizationUrl).toContain(
      "login.salesforce.com/services/oauth2/authorize"
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("application_oauth_txn=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("organization-secret");
  });
});
