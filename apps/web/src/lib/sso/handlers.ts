import { NextResponse, type NextRequest } from "next/server";
import type { SsoConnection, SsoProviderKind } from "@agent-hub/core";
import { openSecret } from "@agent-hub/core";

import { getWidgetDb } from "@/lib/widget-db";
import { getSsoProvider } from "./index";
import {
  SSO_GATE_COOKIE,
  SSO_GATE_MAX_AGE,
  SSO_TXN_COOKIE,
  gateCookieOptions,
  openTxn,
  sealGate,
  sealTxn,
  txnCookieOptions,
} from "./session";
import { SsoCallbackError, type SsoCredentials } from "./types";

/**
 * Route orchestration for the widget SSO flow (ticket #372). Kept apart from
 * the pure adapter/session helpers because it reaches Next + the widget Db.
 * The redirect/callback paths are provider-constant (`/api/sso/{kind}/...`) so
 * one registered redirect URI per deployment serves every org — the
 * assistant/org is carried in the sealed transient, not the URL.
 */

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

/** Resolve the org's connection for an assistant and unseal its secret. */
async function loadCredentials(
  assistantId: string,
  kind: SsoProviderKind
): Promise<{ connection: SsoConnection; credentials: SsoCredentials } | null> {
  const db = getWidgetDb();
  const assistant = await db.getAssistant(assistantId);
  if (!assistant) return null;
  const connection = await db.getSsoConnection(assistant.organizationId);
  if (!connection || connection.provider !== kind) return null;
  return {
    connection,
    credentials: {
      config: connection.config,
      clientSecret: connection.encryptedSecret
        ? openSecret(connection.encryptedSecret)
        : null,
    },
  };
}

/**
 * The callback result page. In the popup flow it posts the result to the widget
 * opener and closes. In the top-level fallback (popup blocked) there is no
 * opener, so it redirects back to the same-origin widget URL — the gate cookie
 * is already set, so the widget loads authenticated.
 */
function resultPage(ok: boolean, returnTo: string | null): string {
  return `<!doctype html><meta charset="utf-8"><body><script>
(function(){
  var returnTo = ${JSON.stringify(returnTo)};
  try {
    if (window.opener) {
      window.opener.postMessage({ type: "ciele-sso", ok: ${ok} }, "*");
      window.close();
      return;
    }
  } catch (e) {}
  if (returnTo) { window.location.replace(returnTo); } else { window.close(); }
})();
</script>You may close this window.</body>`;
}

/** GET /api/sso/[provider]/start?assistantId=… — 302 to the IdP. */
export async function startSsoFlow(
  request: NextRequest,
  kind: SsoProviderKind
): Promise<NextResponse> {
  const provider = getSsoProvider(kind);
  if (!provider) {
    return new NextResponse("SSO provider not supported", { status: 400 });
  }
  const assistantId = new URL(request.url).searchParams.get("assistantId");
  if (!assistantId) {
    return new NextResponse("Missing assistantId", { status: 400 });
  }
  const loaded = await loadCredentials(assistantId, kind);
  if (!loaded) {
    return new NextResponse("No SSO connection for this assistant", { status: 404 });
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const redirectUri = `${origin}/api/sso/${kind}/callback`;
  const returnTo = sameOriginReturnTo(url.searchParams.get("returnTo"), origin);
  const { authorizationUrl, transient } = await provider.initiate(
    loaded.credentials,
    { redirectUri }
  );

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(
    SSO_TXN_COOKIE,
    sealTxn({
      ...transient,
      assistantId,
      organizationId: loaded.connection.organizationId,
      provider: kind,
      returnTo: returnTo ?? undefined,
    }),
    txnCookieOptions
  );
  return response;
}

/** GET /api/sso/[provider]/callback?code=&state= — verify, mint the gate cookie. */
export async function handleSsoCallback(
  request: NextRequest,
  kind: SsoProviderKind
): Promise<NextResponse> {
  const failure = (returnTo: string | null = null) => {
    const res = new NextResponse(resultPage(false, returnTo), {
      headers: HTML_HEADERS,
    });
    res.cookies.delete(SSO_TXN_COOKIE);
    return res;
  };

  const url = new URL(request.url);
  const txn = openTxn(request.cookies.get(SSO_TXN_COOKIE)?.value);
  const returnTo = txn?.returnTo ?? null;
  if (url.searchParams.get("error")) return failure(returnTo);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !txn || txn.provider !== kind) return failure(returnTo);

  const provider = getSsoProvider(kind);
  const loaded = await loadCredentials(txn.assistantId, kind);
  if (!provider || !loaded) return failure(returnTo);

  let subjectId: string;
  let identityClaimValue: string | undefined;
  try {
    ({ subjectId, identityClaimValue } = await provider.handleCallback(
      loaded.credentials,
      { code, state },
      {
        state: txn.state,
        nonce: txn.nonce,
        codeVerifier: txn.codeVerifier,
        redirectUri: txn.redirectUri,
      }
    ));
  } catch (err) {
    if (err instanceof SsoCallbackError) return failure(returnTo);
    throw err;
  }

  // The claim rides the gate only under its configured name (#662): value
  // without a still-configured name is dropped, keeping the cookie coherent
  // with the connection's current settings.
  const claimName = loaded.credentials.config.identityClaim;

  const response = new NextResponse(resultPage(true, returnTo), {
    headers: HTML_HEADERS,
  });
  response.cookies.set(
    SSO_GATE_COOKIE,
    sealGate({
      organizationId: txn.organizationId,
      subjectId,
      provider: kind,
      ...(claimName && identityClaimValue
        ? { claim: { name: claimName, value: identityClaimValue } }
        : {}),
      exp: Math.floor(Date.now() / 1000) + SSO_GATE_MAX_AGE,
    }),
    gateCookieOptions
  );
  response.cookies.delete(SSO_TXN_COOKIE);
  return response;
}

/**
 * POST /api/sso/[provider]/logout — clear the (org-scoped) gate cookie, so it
 * needs no provider. An `?returnTo=` sends the browser onward afterward.
 */
export async function logoutSsoFlow(
  request: NextRequest
): Promise<NextResponse> {
  const url = new URL(request.url);
  const safeReturnTo = sameOriginReturnTo(url.searchParams.get("returnTo"), url.origin);
  const response = safeReturnTo
    ? NextResponse.redirect(safeReturnTo)
    : new NextResponse(null, { status: 204 });
  response.cookies.delete(SSO_GATE_COOKIE);
  return response;
}

/**
 * Resolve a `returnTo` only if it stays on our origin (absolute same-origin, or
 * a relative path) — an attacker-supplied off-site URL is dropped, closing an
 * open-redirect. Returns the absolute URL to redirect to, or `null`.
 */
function sameOriginReturnTo(
  returnTo: string | null,
  origin: string
): string | null {
  if (!returnTo) return null;
  try {
    const resolved = new URL(returnTo, origin);
    return resolved.origin === origin ? resolved.toString() : null;
  } catch {
    return null;
  }
}
