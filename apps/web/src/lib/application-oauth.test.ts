import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_OAUTH_PROVIDERS,
  applicationOAuthAvailability,
  applicationAuthorizationUrl,
  exchangeApplicationOAuthCode,
  newApplicationOAuthTransaction,
  openApplicationOAuthTransaction,
  safeApplicationReturnTo,
  sealApplicationOAuthTransaction,
} from "./application-oauth";

beforeEach(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", "test-application-oauth-key");
});

describe("Application OAuth", () => {
  it("registers every v1 provider", () => {
    expect(APPLICATION_OAUTH_PROVIDERS).toEqual([
      "salesforce",
      "servicenow",
      "slack",
      "onedrive",
      "google_drive",
    ]);
  });

  it("binds a sealed, expiring transaction to member, org, redirect, and PKCE", () => {
    const transaction = newApplicationOAuthTransaction({
      provider: "salesforce",
      organizationId: "org-1",
      memberId: "member-1",
      returnTo: "/library/applications",
      redirectUri: "https://ciele.example/api/applications/oauth/salesforce/callback",
      providerSettings: { loginUrl: "https://login.salesforce.com" },
    });
    const opened = openApplicationOAuthTransaction(
      sealApplicationOAuthTransaction(transaction)
    );
    expect(opened).toMatchObject({
      organizationId: "org-1",
      memberId: "member-1",
      redirectUri:
        "https://ciele.example/api/applications/oauth/salesforce/callback",
      providerSettings: { loginUrl: "https://login.salesforce.com" },
    });
    expect(opened?.nonce).toBeTruthy();
    expect(opened?.codeVerifier).toBeTruthy();
  });

  it("uses authorization-code endpoints for Salesforce and ServiceNow", () => {
    const salesforce = newApplicationOAuthTransaction({
      provider: "salesforce",
      organizationId: "org",
      memberId: "member",
      returnTo: "/library/applications",
      redirectUri: "https://ciele.example/salesforce/callback",
      providerSettings: {
        loginUrl: "https://test.salesforce.com",
        clientId: "organization-client",
        clientSecret: "organization-secret",
      },
    });
    const salesforceUrl = new URL(
      applicationAuthorizationUrl({ transaction: salesforce })
    );
    expect(salesforceUrl.origin).toBe("https://test.salesforce.com");
    expect(salesforceUrl.searchParams.get("client_id")).toBe(
      "organization-client"
    );

    const servicenow = newApplicationOAuthTransaction({
      provider: "servicenow",
      organizationId: "org",
      memberId: "member",
      returnTo: "/library/applications",
      redirectUri: "https://ciele.example/servicenow/callback",
      providerSettings: {
        baseUrl: "https://acme.service-now.com",
        clientId: "instance-client",
        clientSecret: "instance-secret",
      },
    });
    const url = new URL(
      applicationAuthorizationUrl({ transaction: servicenow })
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://acme.service-now.com/oauth_auth.do"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges a Salesforce code and pins the returned instance origin", async () => {
    const transaction = newApplicationOAuthTransaction({
      provider: "salesforce",
      organizationId: "org",
      memberId: "member",
      returnTo: "/library/applications",
      redirectUri: "https://ciele.example/callback",
      providerSettings: {
        connectionName: "Admissions Salesforce",
        loginUrl: "https://login.salesforce.com",
        clientId: "organization-client",
        clientSecret: "organization-secret",
      },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          instance_url: "https://acme.my.salesforce.com",
          id: "https://login.salesforce.com/id/00D/005",
          scope: "api refresh_token",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await exchangeApplicationOAuthCode({
      transaction,
      code: "code",
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result).toMatchObject({
      name: "Admissions Salesforce",
      providerAccountId: "https://login.salesforce.com/id/00D/005",
      credentials: { instanceUrl: "https://acme.my.salesforce.com" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://login.salesforce.com/services/oauth2/token",
      expect.any(Object)
    );
  });

  it("keeps per-Organization Salesforce available without deployment credentials", () => {
    vi.stubEnv("SALESFORCE_APPLICATION_CLIENT_ID", "");
    vi.stubEnv("SALESFORCE_APPLICATION_CLIENT_SECRET", "");
    expect(applicationOAuthAvailability().salesforce).toEqual({
      configured: true,
      guidance: "Enter the OAuth registration for your Salesforce Organization.",
    });
  });

  it("rejects protocol-relative and unrelated return locations", () => {
    expect(safeApplicationReturnTo("//evil.example")).toBe(
      "/library/applications"
    );
    expect(safeApplicationReturnTo("/assistants/a/knowledge")).toBe(
      "/assistants/a/knowledge"
    );
    expect(safeApplicationReturnTo("/settings")).toBe(
      "/library/applications"
    );
    expect(
      safeApplicationReturnTo(
        "/assistants/</script><script>alert(1)</script>/knowledge"
      )
    ).toBe("/library/applications");
  });
});
