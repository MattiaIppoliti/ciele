import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  canAuthorizeApplicationProvider,
  canReconnectApplicationConnection,
} from "@/lib/application-connections";
import {
  APPLICATION_OAUTH_COOKIE,
  APPLICATION_OAUTH_MAX_AGE,
  applicationAuthorizationUrl,
  invalidApplicationOAuthScope,
  isApplicationOAuthProvider,
  newApplicationOAuthTransaction,
  safeApplicationReturnTo,
  sealApplicationOAuthTransaction,
} from "@/lib/application-oauth";

export const runtime = "nodejs";

async function beginOAuth(input: {
  request: NextRequest;
  provider: string;
  returnTo: string | null;
  providerSettings?: {
    connectionName?: string;
    loginUrl?: string;
    baseUrl?: string;
    clientId?: string;
    clientSecret?: string;
  };
  responseKind: "redirect" | "json";
  connectionId?: string;
  /** Extra scopes for a Connector re-consent (#839); unioned with the defaults. */
  scopes?: string[];
}) {
  const { request, provider } = input;
  if (!isApplicationOAuthProvider(provider)) {
    return new Response("Unknown Application provider", { status: 404 });
  }
  const session = await getSession();
  if (!session?.organization) return new Response("Unauthorized", { status: 401 });
  if (!canAuthorizeApplicationProvider(provider, session.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  // Widening a grant is a re-consent of an existing row; a fresh connection
  // always starts from the provider's defaults, so its scopes are ignored.
  const scopes = input.connectionId ? input.scopes : undefined;
  // The caller's input, checked before any I/O: a malformed scope is the
  // caller's mistake (400), not a provider outage (503).
  const invalidScope = invalidApplicationOAuthScope(scopes);
  if (invalidScope !== null) {
    return new Response(`Invalid OAuth scope "${invalidScope}"`, { status: 400 });
  }
  try {
    if (input.connectionId) {
      const connection = await (await getDb()).getSafeApplicationConnection(
        input.connectionId
      );
      if (
        !connection ||
        connection.organizationId !== session.organization.id ||
        connection.provider !== provider ||
        !canReconnectApplicationConnection(
          connection,
          session.userId,
          session.role
        )
      ) {
        return new Response("Application Connection not found", { status: 404 });
      }
    }
    const redirectUri = new URL(
      `/api/applications/oauth/${provider}/callback`,
      request.url
    ).toString();
    const transaction = newApplicationOAuthTransaction({
      provider,
      organizationId: session.organization.id,
      memberId: session.userId,
      returnTo: safeApplicationReturnTo(input.returnTo),
      redirectUri,
      providerSettings: input.providerSettings,
      connectionId: input.connectionId,
      scopes,
    });
    const authorizationUrl = applicationAuthorizationUrl({ transaction });
    await (await getDb()).createApplicationOAuthNonce({
      nonce: transaction.nonce,
      organizationId: transaction.organizationId,
      memberId: transaction.memberId,
      expiresAt: new Date(
        transaction.createdAt + APPLICATION_OAUTH_MAX_AGE * 1000
      ).toISOString(),
    });
    const response =
      input.responseKind === "redirect"
        ? NextResponse.redirect(authorizationUrl)
        : NextResponse.json({ authorizationUrl });
    response.cookies.set(
      APPLICATION_OAUTH_COOKIE,
      sealApplicationOAuthTransaction(transaction),
      {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/api/applications/oauth",
        maxAge: APPLICATION_OAUTH_MAX_AGE,
      }
    );
    return response;
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "OAuth setup failed", {
      status: 503,
    });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  return beginOAuth({
    request,
    provider,
    returnTo: request.nextUrl.searchParams.get("returnTo"),
    providerSettings:
      provider === "salesforce"
        ? { loginUrl: request.nextUrl.searchParams.get("loginUrl") ?? undefined }
        : undefined,
    responseKind: "redirect",
    connectionId:
      request.nextUrl.searchParams.get("connectionId") ?? undefined,
    scopes: request.nextUrl.searchParams.get("scopes")?.split(/\s+/).filter(Boolean),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return beginOAuth({
    request,
    provider,
    returnTo: typeof body.returnTo === "string" ? body.returnTo : null,
    providerSettings: {
      connectionName:
        typeof body.connectionName === "string"
          ? body.connectionName
          : undefined,
      loginUrl: typeof body.loginUrl === "string" ? body.loginUrl : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret:
        typeof body.clientSecret === "string" ? body.clientSecret : undefined,
    },
    responseKind: "json",
    connectionId:
      typeof body.connectionId === "string" ? body.connectionId : undefined,
    scopes: Array.isArray(body.scopes)
      ? body.scopes.filter((scope): scope is string => typeof scope === "string")
      : undefined,
  });
}
