import { openSecret } from "@agent-hub/core";
import { egressFetch } from "./egress";
import { htmlToText } from "./extract";
import type {
  ApplicationConnector,
  ApplicationCredentials,
} from "./application-connectors";

const REQUEST_TIMEOUT_MS = 30_000;
const JSON_MAX_BYTES = 10 * 1024 * 1024;

export interface ApplicationHttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  bytes?: Uint8Array;
}

export type ApplicationHttpClient = (
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    maxResponseBytes?: number;
    maxRedirects?: number;
  }
) => Promise<ApplicationHttpResponse>;

export function observeHttpClient(
  delegate: ApplicationHttpClient,
  onProgress?: () => Promise<void>
) {
  let providerCalls = 0;
  let bytes = 0;
  return {
    client: (async (url, options) => {
      await onProgress?.();
      providerCalls += 1;
      const response = await delegate(url, options);
      bytes +=
        response.bytes?.byteLength ??
        new TextEncoder().encode(response.text).byteLength;
      return response;
    }) satisfies ApplicationHttpClient,
    metrics: () => ({ providerCalls, bytes }),
  };
}

export const defaultApplicationHttpClient: ApplicationHttpClient = async (
  url,
  options
) => {
  const { response } = await egressFetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxResponseBytes: options.maxResponseBytes ?? JSON_MAX_BYTES,
    maxRedirects: options.maxRedirects ?? 0,
    allowHttp: false,
  });
  return response;
};

export class ApplicationAuthorizationError extends Error {
  readonly retryable = false;

  constructor(message = "Application authorization is no longer valid") {
    super(message);
    this.name = "ApplicationAuthorizationError";
  }
}

export class ApplicationRateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    message = "Provider rate limit reached"
  ) {
    super(message);
    this.name = "ApplicationRateLimitError";
  }
}

export class ApplicationArtifactSkipError extends Error {}

export function applicationRetryAfterMs(headers: Headers): number {
  const raw = headers.get("retry-after")?.trim() ?? "";
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}

export function trustedUrl(rawUrl: string, allowedHosts: string[]): string {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !allowedHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    )
  ) {
    throw new Error(`Connector refused an untrusted provider URL: ${host}`);
  }
  return url.toString();
}

export function optionalTrustedUrl(
  rawUrl: string,
  allowedHosts: string[]
): string | null {
  if (!rawUrl) return null;
  try {
    return trustedUrl(rawUrl, allowedHosts);
  } catch {
    return null;
  }
}

export function applicationCredentials(connection: {
  sealedCredentials: string;
}): ApplicationCredentials {
  const parsed = JSON.parse(
    openSecret(connection.sealedCredentials)
  ) as ApplicationCredentials;
  if (!parsed.accessToken) {
    throw new ApplicationAuthorizationError("Access token is missing");
  }
  return parsed;
}

export async function applicationJsonRequest<T>(
  client: ApplicationHttpClient,
  url: string,
  accessToken: string,
  allowedHosts: string[],
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await client(trustedUrl(url, allowedHosts), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      ...headers,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new ApplicationAuthorizationError();
  }
  if (response.status === 429) {
    throw new ApplicationRateLimitError(applicationRetryAfterMs(response.headers));
  }
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new Error("Provider returned invalid JSON");
  }
}

export async function refreshApplicationCredentials(
  provider: ApplicationConnector["provider"],
  current: ApplicationCredentials,
  client: ApplicationHttpClient
): Promise<{
  active: ApplicationCredentials;
  refreshed?: ApplicationCredentials;
}> {
  const expiresAt = current.expiresAt
    ? new Date(current.expiresAt).getTime()
    : Infinity;
  if (expiresAt > Date.now() + 60_000) return { active: current };
  if (!current.refreshToken || !current.clientId) {
    throw new ApplicationAuthorizationError(
      "The provider must be connected again"
    );
  }
  const tokenUrl =
    current.tokenUrl ??
    (provider === "google_drive"
      ? "https://oauth2.googleapis.com/token"
      : provider === "onedrive"
        ? `https://login.microsoftonline.com/${current.tenantId ?? "organizations"}/oauth2/v2.0/token`
        : provider === "slack"
          ? "https://slack.com/api/oauth.v2.access"
          : provider === "salesforce"
            ? "https://login.salesforce.com/services/oauth2/token"
            : `${current.baseUrl?.replace(/\/$/, "")}/oauth_token.do`);
  const allowedHosts =
    provider === "google_drive"
      ? ["oauth2.googleapis.com"]
      : provider === "onedrive"
        ? ["login.microsoftonline.com"]
        : provider === "slack"
          ? ["slack.com"]
          : provider === "salesforce"
            ? ["salesforce.com"]
            : [new URL(current.baseUrl!).hostname];
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: current.clientId,
  });
  form.set("refresh_token", current.refreshToken);
  if (current.clientSecret) form.set("client_secret", current.clientSecret);
  const response = await client(trustedUrl(tokenUrl, allowedHosts), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (response.status === 429) {
    throw new ApplicationRateLimitError(applicationRetryAfterMs(response.headers));
  }
  if (!response.ok) {
    throw new ApplicationAuthorizationError("Token refresh failed");
  }
  const token = JSON.parse(response.text) as Record<string, unknown>;
  const accessToken = String(token.access_token ?? "");
  if (!accessToken) {
    throw new ApplicationAuthorizationError(
      "Token refresh returned no access token"
    );
  }
  const refreshed: ApplicationCredentials = {
    ...current,
    accessToken,
    refreshToken: String(token.refresh_token ?? current.refreshToken),
    expiresAt: new Date(
      Date.now() + Number(token.expires_in ?? 3600) * 1000
    ).toISOString(),
    instanceUrl:
      String(token.instance_url ?? current.instanceUrl ?? "") || undefined,
    teamId: String(token.team_id ?? current.teamId ?? "") || undefined,
  };
  return { active: refreshed, refreshed };
}

export async function normalizedApplicationText(value: string): Promise<string> {
  if (!/[<>]/.test(value)) return value.trim();
  return (await htmlToText(`<body>${value}</body>`)).text;
}

export function applicationContentStrings(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    return /(body|content|text|summary|description|answer|value)/i.test(key)
      ? [value]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => applicationContentStrings(item, key));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([childKey, item]) => applicationContentStrings(item, childKey)
  );
}

export function applicationValueArray(
  value: unknown,
  ...keys: string[]
): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}
