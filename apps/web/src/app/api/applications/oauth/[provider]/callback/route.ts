import { NextResponse, type NextRequest } from "next/server";
import { applicationConnectionOwnerType, sealSecret } from "@agent-hub/core";
import { connectorAlertKey } from "@agent-hub/agent";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getWidgetDb } from "@/lib/widget-db";
import {
  canAuthorizeApplicationProvider,
  canReconnectApplicationConnection,
} from "@/lib/application-connections";
import {
  APPLICATION_OAUTH_COOKIE,
  exchangeApplicationOAuthCode,
  isApplicationOAuthProvider,
  openApplicationOAuthTransaction,
} from "@/lib/application-oauth";
import {
  APPLICATION_CONNECTED_MESSAGE,
  type ApplicationConnectedMessage,
} from "@/lib/application-connected";
import { revalidateEntities } from "@/lib/org-mutation";

export const runtime = "nodejs";

function completionPage(returnTo: string, provider: string): NextResponse {
  const inlineJson = (value: unknown) =>
    JSON.stringify(value).replaceAll("<", "\\u003c");
  const destination = inlineJson(returnTo);
  const payload: ApplicationConnectedMessage = { type: APPLICATION_CONNECTED_MESSAGE, provider };
  const message = inlineJson(payload);
  return new NextResponse(
    `<!doctype html><html><body><p>Connection complete. You can close this window.</p><script>if(window.opener){window.opener.postMessage(${message},window.location.origin);window.close()}else{window.location.href=${destination}}</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function clearTransaction(response: NextResponse): NextResponse {
  response.cookies.delete(APPLICATION_OAUTH_COOKIE);
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isApplicationOAuthProvider(provider)) {
    return new Response("Unknown Application provider", { status: 404 });
  }
  const transaction = openApplicationOAuthTransaction(
    request.cookies.get(APPLICATION_OAUTH_COOKIE)?.value
  );
  if (
    !transaction ||
    transaction.provider !== provider ||
    transaction.nonce !== request.nextUrl.searchParams.get("state")
  ) {
    return new Response("Invalid or expired OAuth transaction", { status: 400 });
  }
  const session = await getSession();
  if (
    !session?.organization ||
    session.organization.id !== transaction.organizationId ||
    session.userId !== transaction.memberId ||
    !canAuthorizeApplicationProvider(provider, session.role)
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const sessionDb = await getDb();
  const consumed = await sessionDb.consumeApplicationOAuthNonce({
    nonce: transaction.nonce,
    organizationId: transaction.organizationId,
    memberId: transaction.memberId,
    consumedAt: new Date().toISOString(),
  });
  if (!consumed) {
    return clearTransaction(
      new NextResponse("Invalid or replayed OAuth transaction", { status: 400 })
    );
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return clearTransaction(
      new NextResponse("Authorization was cancelled", { status: 400 })
    );
  }
  try {
    const callbackUri = new URL(
      `/api/applications/oauth/${provider}/callback`,
      request.url
    ).toString();
    if (callbackUri !== transaction.redirectUri) {
      return clearTransaction(
        new NextResponse("OAuth callback origin does not match", { status: 400 })
      );
    }
    const result = await exchangeApplicationOAuthCode({
      transaction,
      code,
    });
    const mutationDb = getWidgetDb();
    const ownerType = applicationConnectionOwnerType(provider);
    if (transaction.connectionId) {
      const visible = await sessionDb.getSafeApplicationConnection(
        transaction.connectionId
      );
      if (
        !visible ||
        visible.organizationId !== transaction.organizationId ||
        visible.provider !== provider ||
        !canReconnectApplicationConnection(
          visible,
          transaction.memberId,
          session.role
        )
      ) {
        return clearTransaction(
          new NextResponse("Application Connection not found", { status: 404 })
        );
      }
      await mutationDb.updateApplicationConnection(visible.id, {
        ...(ownerType === "member"
          ? { ownerType, ownerMemberId: transaction.memberId }
          : {}),
        name: result.name,
        sealedCredentials: sealSecret(JSON.stringify(result.credentials)),
        scopes: result.scopes,
        providerAccountId: result.providerAccountId,
        metadata: result.metadata,
        status: "connected",
        error: "",
        lastConnectedAt: new Date().toISOString(),
      });
      // A reconnect clears the Alert a failed Connector call raised (#839),
      // and the Alerts page and its sidebar badge render that row, so they are
      // revalidated the way every other alert mutation does it (ADR-0005).
      await mutationDb.resolveAlertsByKey(
        transaction.organizationId,
        connectorAlertKey(visible.id)
      );
      revalidateEntities([{ kind: "alerts" }], transaction.organizationId);
    } else {
      await mutationDb.createApplicationConnection({
        organizationId: transaction.organizationId,
        ownerMemberId:
          ownerType === "member" ? transaction.memberId : undefined,
        provider,
        name: result.name,
        sealedCredentials: sealSecret(JSON.stringify(result.credentials)),
        scopes: result.scopes,
        providerAccountId: result.providerAccountId,
        metadata: result.metadata,
      });
    }
    return clearTransaction(completionPage(transaction.returnTo, provider));
  } catch (error) {
    return clearTransaction(
      new NextResponse(
        error instanceof Error ? error.message : "OAuth callback failed",
        { status: 502 }
      )
    );
  }
}
