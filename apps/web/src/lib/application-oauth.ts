import { createHash, randomBytes } from "node:crypto";
import type { ApplicationCredentials } from "@agent-hub/agent";
import type { ApplicationProvider } from "@agent-hub/core";
import { openSecret, sealSecret } from "@agent-hub/core";

export type ApplicationOAuthProvider = ApplicationProvider;

export const APPLICATION_OAUTH_PROVIDERS: ApplicationOAuthProvider[] = [
  "salesforce",
  "servicenow",
  "slack",
  "onedrive",
  "google_drive",
  "microsoft_mail",
];

export const APPLICATION_OAUTH_COOKIE = "application_oauth_txn";
export const APPLICATION_OAUTH_MAX_AGE = 10 * 60;

export interface ApplicationOAuthProviderSettings {
  /** Human-readable name chosen by the Organization administrator. */
  connectionName?: string;
  /** Salesforce production, sandbox, or validated My Domain origin. */
  loginUrl?: string;
  /** Instance-specific ServiceNow origin. */
  baseUrl?: string;
  /** Customer-owned ServiceNow OAuth registration. */
  clientId?: string;
  clientSecret?: string;
}

export interface ApplicationOAuthTransaction {
  nonce: string;
  provider: ApplicationOAuthProvider;
  organizationId: string;
  memberId: string;
  returnTo: string;
  redirectUri: string;
  codeVerifier: string;
  providerSettings: ApplicationOAuthProviderSettings;
  /** Existing authorization to refresh in place, after server-side ownership check. */
  connectionId?: string;
  /**
   * Scopes to request beyond the provider's defaults (#839): a re-consent that
   * adds what a Connector action needs. Unioned with the defaults, never
   * replacing them, so a re-consent can only widen what the import already had.
   */
  scopes?: string[];
  createdAt: number;
}

export function isApplicationOAuthProvider(
  value: string
): value is ApplicationOAuthProvider {
  return APPLICATION_OAUTH_PROVIDERS.includes(
    value as ApplicationOAuthProvider
  );
}

function requireEncryptionKey(): void {
  if (!process.env.APP_ENCRYPTION_KEY) {
    throw new Error("APP_ENCRYPTION_KEY is required for Application OAuth");
  }
}

export function sealApplicationOAuthTransaction(
  transaction: ApplicationOAuthTransaction
): string {
  requireEncryptionKey();
  return sealSecret(JSON.stringify(transaction));
}

export function openApplicationOAuthTransaction(
  sealed: string | undefined
): ApplicationOAuthTransaction | null {
  if (!sealed || sealed.startsWith("plain:")) return null;
  try {
    const transaction = JSON.parse(
      openSecret(sealed)
    ) as ApplicationOAuthTransaction;
    if (
      !isApplicationOAuthProvider(transaction.provider) ||
      !transaction.memberId ||
      !transaction.redirectUri ||
      Date.now() - transaction.createdAt > APPLICATION_OAUTH_MAX_AGE * 1000
    ) {
      return null;
    }
    return transaction;
  } catch {
    return null;
  }
}

/**
 * The two Entra-backed providers (#841): one app registration, one
 * authorization and token endpoint, one Graph profile call; only the consent
 * differs. Every branch that treats them alike asks this rather than spelling
 * the pair out, so a third Microsoft provider is one edit here.
 */
export function isMicrosoftProvider(provider: ApplicationOAuthProvider): boolean {
  return provider === "onedrive" || provider === "microsoft_mail";
}

function providerPrefix(
  provider: Exclude<ApplicationOAuthProvider, "salesforce" | "servicenow">
) {
  if (provider === "slack") return "SLACK";
  if (isMicrosoftProvider(provider)) return "MICROSOFT";
  return "GOOGLE";
}

function providerClient(transaction: ApplicationOAuthTransaction): {
  clientId: string;
  clientSecret: string;
} {
  if (
    transaction.provider === "salesforce" ||
    transaction.provider === "servicenow"
  ) {
    const clientId = transaction.providerSettings.clientId?.trim() ?? "";
    const clientSecret =
      transaction.providerSettings.clientSecret?.trim() ?? "";
    if (!clientId || !clientSecret) {
      const label =
        transaction.provider === "salesforce" ? "Salesforce" : "ServiceNow";
      throw new Error(`${label} OAuth client details are required`);
    }
    return { clientId, clientSecret };
  }
  const prefix = providerPrefix(transaction.provider);
  const clientId = process.env[`${prefix}_APPLICATION_CLIENT_ID`] ?? "";
  const clientSecret =
    process.env[`${prefix}_APPLICATION_CLIENT_SECRET`] ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(`${prefix} Application OAuth is not configured`);
  }
  return { clientId, clientSecret };
}

export type ApplicationOAuthAvailability = Record<
  ApplicationOAuthProvider,
  { configured: boolean; guidance: string }
>;

export function applicationOAuthAvailability(): ApplicationOAuthAvailability {
  const configured = (prefix: string) =>
    Boolean(
      process.env[`${prefix}_APPLICATION_CLIENT_ID`] &&
        process.env[`${prefix}_APPLICATION_CLIENT_SECRET`]
    );
  return {
    salesforce: {
      configured: true,
      guidance: "Enter the OAuth registration for your Salesforce Organization.",
    },
    servicenow: {
      configured: true,
      guidance: "Enter the OAuth registration for your ServiceNow instance.",
    },
    slack: {
      configured: configured("SLACK"),
      guidance:
        "Configure SLACK_APPLICATION_CLIENT_ID and SLACK_APPLICATION_CLIENT_SECRET.",
    },
    onedrive: {
      configured: configured("MICROSOFT"),
      guidance:
        "Configure MICROSOFT_APPLICATION_CLIENT_ID and MICROSOFT_APPLICATION_CLIENT_SECRET.",
    },
    google_drive: {
      configured: configured("GOOGLE"),
      guidance:
        "Configure GOOGLE_APPLICATION_CLIENT_ID and GOOGLE_APPLICATION_CLIENT_SECRET.",
    },
    // Same Entra app registration as OneDrive (#841); the consent differs.
    microsoft_mail: {
      configured: configured("MICROSOFT"),
      guidance:
        "Configure MICROSOFT_APPLICATION_CLIENT_ID and MICROSOFT_APPLICATION_CLIENT_SECRET.",
    },
  };
}

export function newApplicationOAuthTransaction(input: {
  provider: ApplicationOAuthProvider;
  organizationId: string;
  memberId: string;
  returnTo: string;
  redirectUri: string;
  providerSettings?: ApplicationOAuthProviderSettings;
  connectionId?: string;
  scopes?: string[];
}): ApplicationOAuthTransaction {
  return {
    ...input,
    providerSettings: input.providerSettings ?? {},
    nonce: randomBytes(24).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    createdAt: Date.now(),
  };
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Which providers get S256 PKCE, stated once (#801, CYB-15).
 *
 * It used to be two separate negations, one in the authorization URL and one
 * in the token form, and nothing stopped them from disagreeing: a challenge
 * sent without a verifier fails the exchange, a verifier sent without a
 * challenge is a no-op that looks like a control. One table, read by both
 * halves, is what makes `applicationOAuthPkceContract` a real test.
 *
 * `unsupported` is an exception that has to be argued for, not a default.
 */
export const APPLICATION_OAUTH_PKCE: Record<
  ApplicationOAuthProvider,
  "s256" | "unsupported"
> = {
  salesforce: "s256",
  // Enforced per OAuth application registry entry. An instance with PKCE off
  // ignores both parameters, so sending them costs nothing and the control
  // turns on the moment the tenant enables it.
  servicenow: "s256",
  // Slack's `oauth/v2` bot-token flow has no PKCE: the challenge is ignored
  // and the verifier is never checked. Sending them would read like a control
  // in the code and be none in the protocol, so the exception is explicit and
  // the confidential client secret plus `state` carry the binding instead.
  slack: "unsupported",
  onedrive: "s256",
  google_drive: "s256",
  microsoft_mail: "s256",
};

function trustedProviderOrigin(
  raw: string,
  provider: "salesforce" | "servicenow"
): string {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  const trusted =
    provider === "salesforce"
      ? hostname === "login.salesforce.com" ||
        hostname === "test.salesforce.com" ||
        hostname.endsWith(".my.salesforce.com")
      : hostname.endsWith(".service-now.com");
  if (url.protocol !== "https:" || !trusted || url.username || url.password) {
    throw new Error(`Untrusted ${provider} OAuth origin`);
  }
  return url.origin;
}

function authorizationEndpoint(transaction: ApplicationOAuthTransaction): string {
  if (transaction.provider === "salesforce") {
    const origin = trustedProviderOrigin(
      transaction.providerSettings.loginUrl ?? "https://login.salesforce.com",
      "salesforce"
    );
    return `${origin}/services/oauth2/authorize`;
  }
  if (transaction.provider === "servicenow") {
    const origin = trustedProviderOrigin(
      transaction.providerSettings.baseUrl ?? "",
      "servicenow"
    );
    return `${origin}/oauth_auth.do`;
  }
  if (transaction.provider === "slack") {
    return "https://slack.com/oauth/v2/authorize";
  }
  if (isMicrosoftProvider(transaction.provider)) {
    return "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize";
  }
  return "https://accounts.google.com/o/oauth2/v2/auth";
}

/** The scopes the Knowledge import needs from each provider, the floor of every grant. */
export const APPLICATION_OAUTH_DEFAULT_SCOPES: Record<ApplicationOAuthProvider, string[]> = {
  slack: ["channels:history", "channels:read", "groups:history", "groups:read", "users:read"],
  onedrive: ["offline_access", "Files.Read", "User.Read"],
  google_drive: ["https://www.googleapis.com/auth/drive.readonly"],
  // The Human review sender (#841): delegated send from the Member's own mailbox.
  microsoft_mail: ["offline_access", "Mail.Send", "User.Read"],
  salesforce: ["api", "refresh_token"],
  servicenow: ["useraccount"],
};

/**
 * The first extra scope that is not a bare token, or null when every one is.
 * A scope carrying whitespace or a comma would splice into the provider's
 * query string, and one over 200 characters is nobody's scope. The start route
 * asks this before it does anything else, so a caller's typo is a 400 and not
 * the 503 the same check used to surface as from inside the URL builder.
 */
export function invalidApplicationOAuthScope(scopes: readonly string[] | undefined): string | null {
  for (const scope of scopes ?? []) {
    const trimmed = scope.trim();
    if (!trimmed) continue;
    if (/[\s,]/.test(trimmed) || trimmed.length > 200) return trimmed;
  }
  return null;
}

/**
 * What one authorization asks for: the provider's defaults plus the
 * transaction's extra scopes (a Connector re-consent, #839), deduplicated in
 * request order. A scope is a bare token; anything with whitespace or a comma
 * is refused here rather than spliced into the provider's query string.
 */
export function applicationOAuthScopes(
  transaction: Pick<ApplicationOAuthTransaction, "provider" | "scopes">
): string[] {
  const invalid = invalidApplicationOAuthScope(transaction.scopes);
  if (invalid !== null) throw new Error(`Invalid OAuth scope "${invalid}"`);
  const extra = (transaction.scopes ?? []).map((scope) => scope.trim()).filter(Boolean);
  return [...new Set([...APPLICATION_OAUTH_DEFAULT_SCOPES[transaction.provider], ...extra])];
}

export function applicationAuthorizationUrl(input: {
  transaction: ApplicationOAuthTransaction;
}): string {
  const { transaction } = input;
  const { clientId } = providerClient(transaction);
  const url = new URL(authorizationEndpoint(transaction));
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", transaction.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", transaction.nonce);
  const requested = applicationOAuthScopes(transaction);
  if (transaction.provider === "slack") {
    url.searchParams.set("scope", requested.join(","));
  } else {
    url.searchParams.set("scope", requested.join(" "));
    if (transaction.provider === "google_drive") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
    }
  }
  if (APPLICATION_OAUTH_PKCE[transaction.provider] === "s256") {
    url.searchParams.set("code_challenge", challenge(transaction.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export interface ApplicationOAuthResult {
  credentials: ApplicationCredentials;
  name: string;
  providerAccountId: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
}

async function oauthJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch
): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { ...init, redirect: "error" });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || body.ok === false || body.error) {
    throw new Error(`Provider authorization failed (HTTP ${response.status})`);
  }
  return body;
}

function tokenEndpoint(transaction: ApplicationOAuthTransaction): string {
  if (transaction.provider === "salesforce") {
    return `${trustedProviderOrigin(
      transaction.providerSettings.loginUrl ?? "https://login.salesforce.com",
      "salesforce"
    )}/services/oauth2/token`;
  }
  if (transaction.provider === "servicenow") {
    return `${trustedProviderOrigin(
      transaction.providerSettings.baseUrl ?? "",
      "servicenow"
    )}/oauth_token.do`;
  }
  if (transaction.provider === "slack") {
    return "https://slack.com/api/oauth.v2.access";
  }
  if (isMicrosoftProvider(transaction.provider)) {
    return "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
  }
  return "https://oauth2.googleapis.com/token";
}

export async function exchangeApplicationOAuthCode(input: {
  transaction: ApplicationOAuthTransaction;
  code: string;
  fetcher?: typeof fetch;
}): Promise<ApplicationOAuthResult> {
  const { transaction, code } = input;
  const fetcher = input.fetcher ?? fetch;
  const { clientId, clientSecret } = providerClient(transaction);
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: transaction.redirectUri,
    grant_type: "authorization_code",
  });
  if (APPLICATION_OAUTH_PKCE[transaction.provider] === "s256") {
    form.set("code_verifier", transaction.codeVerifier);
  }
  const token = await oauthJson(
    tokenEndpoint(transaction),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    },
    fetcher
  );
  const accessToken = String(token.access_token ?? "");
  if (!accessToken) throw new Error("OAuth exchange returned no access token");
  const expiresIn = token.expires_in === undefined ? null : Number(token.expires_in);
  const credentials: ApplicationCredentials = {
    accessToken,
    refreshToken: token.refresh_token ? String(token.refresh_token) : undefined,
    expiresAt: expiresIn !== null && Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : undefined,
    clientId,
    clientSecret,
  };
  const scopes = String(token.scope ?? "")
    .split(/[ ,]/)
    .filter(Boolean);

  if (transaction.provider === "salesforce") {
    const instanceUrl = trustedProviderOrigin(
      String(token.instance_url ?? ""),
      "salesforce"
    );
    credentials.instanceUrl = instanceUrl;
    credentials.tokenUrl = tokenEndpoint(transaction);
    return {
      credentials,
      name:
        transaction.providerSettings.connectionName?.trim() ||
        new URL(instanceUrl).hostname,
      providerAccountId:
        String(token.id ?? "") || new URL(instanceUrl).hostname,
      scopes,
      metadata: { instanceUrl, apiVersion: "v65.0" },
    };
  }

  if (transaction.provider === "servicenow") {
    const baseUrl = trustedProviderOrigin(
      transaction.providerSettings.baseUrl ?? "",
      "servicenow"
    );
    credentials.baseUrl = baseUrl;
    credentials.tokenUrl = `${baseUrl}/oauth_token.do`;
    await oauthJson(
      `${baseUrl}/api/now/table/kb_knowledge_base?sysparm_fields=sys_id&sysparm_limit=1`,
      { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      fetcher
    );
    return {
      credentials,
      name:
        transaction.providerSettings.connectionName?.trim() ||
        new URL(baseUrl).hostname,
      providerAccountId: new URL(baseUrl).hostname,
      scopes,
      metadata: { baseUrl },
    };
  }

  if (transaction.provider === "slack") {
    const team = (token.team as Record<string, unknown> | undefined) ?? {};
    credentials.teamId = String(team.id ?? token.team_id ?? "") || undefined;
    return {
      credentials,
      name: String(team.name ?? "Slack"),
      providerAccountId: credentials.teamId ?? null,
      scopes,
      metadata: { teamName: String(team.name ?? "") },
    };
  }

  if (isMicrosoftProvider(transaction.provider)) {
    credentials.tenantId = "organizations";
    const profile = await oauthJson(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName",
      { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      fetcher
    );
    return {
      credentials,
      // A mailbox is named after its address: that is what colleagues will
      // see in the From line of a review request.
      name:
        transaction.provider === "microsoft_mail"
          ? String(profile.userPrincipalName ?? profile.displayName ?? "Microsoft 365 mail")
          : String(profile.displayName ?? profile.userPrincipalName ?? "OneDrive"),
      providerAccountId: String(profile.id ?? "") || null,
      scopes,
      metadata: { principal: String(profile.userPrincipalName ?? "") },
    };
  }

  const about = await oauthJson(
    "https://www.googleapis.com/drive/v3/about?fields=user",
    { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    fetcher
  );
  const user = (about.user as Record<string, unknown> | undefined) ?? {};
  return {
    credentials,
    name: String(user.displayName ?? user.emailAddress ?? "Google Drive"),
    providerAccountId:
      String(user.permissionId ?? user.emailAddress ?? "") || null,
    scopes,
    metadata: { email: String(user.emailAddress ?? "") },
  };
}

export function safeApplicationReturnTo(value: string | null): string {
  if (
    value === "/library/applications" ||
    (value !== null && /^\/assistants\/[A-Za-z0-9_-]+\/knowledge$/.test(value))
  ) {
    return value;
  }
  return "/library/applications";
}
