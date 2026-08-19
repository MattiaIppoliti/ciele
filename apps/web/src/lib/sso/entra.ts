import { createHash, randomBytes } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { EntraSsoConfig } from "@agent-hub/core";
import {
  SsoCallbackError,
  type SsoProvider,
  type SsoCredentials,
} from "./types";

const base64url = (buf: Buffer): string =>
  buf.toString("base64url");

/** Entra v2.0 endpoints for a given tenant. */
function endpoints(tenantId: string) {
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`;
  return {
    authorize: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
    jwks: `${base}/discovery/v2.0/keys`,
    issuer: `${base}/v2.0`,
    logout: `${base}/oauth2/v2.0/logout`,
  };
}

/**
 * Injectable seams so the adapter is unit-testable without network: `fetch`
 * for the token exchange, and `jwks` to resolve the tenant's verification keys
 * (default: Entra's remote JWKS, cached by `jose`).
 */
export interface EntraDeps {
  fetch?: typeof fetch;
  jwks?: (tenantId: string) => JWTVerifyGetKey;
}

/**
 * Microsoft Entra ID adapter: a confidential-client OIDC authorization-code +
 * PKCE flow run entirely server-side. Validates the `id_token` (signature via
 * the tenant JWKS, issuer, audience, nonce, expiry) and returns `sub` as the
 * subject id, nothing richer (personalization is out of scope). See
 * docs/research/sso-provider-shapes.md §"Microsoft Entra ID".
 */
export function createEntraProvider(deps: EntraDeps = {}): SsoProvider {
  const doFetch = deps.fetch ?? fetch;
  const remoteJwksCache = new Map<string, JWTVerifyGetKey>();
  const getJwks =
    deps.jwks ??
    ((tenantId: string) => {
      let set = remoteJwksCache.get(tenantId);
      if (!set) {
        set = createRemoteJWKSet(new URL(endpoints(tenantId).jwks));
        remoteJwksCache.set(tenantId, set);
      }
      return set;
    });

  const cfg = (creds: SsoCredentials): EntraSsoConfig =>
    creds.config as EntraSsoConfig;

  return {
    kind: "entra",

    async initiate(creds, ctx) {
      const { clientId, tenantId } = cfg(creds);
      const state = base64url(randomBytes(24));
      const nonce = base64url(randomBytes(24));
      const codeVerifier = base64url(randomBytes(48));
      const codeChallenge = base64url(
        createHash("sha256").update(codeVerifier).digest()
      );
      const url = new URL(endpoints(tenantId).authorize);
      // The identity claim (#662) needs the profile/email scopes; the
      // personalization-free default keeps the minimal "openid".
      const scope = cfg(creds).identityClaim ? "openid profile email" : "openid";
      url.search = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: ctx.redirectUri,
        response_mode: "query",
        scope,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return {
        authorizationUrl: url.toString(),
        transient: { state, nonce, codeVerifier, redirectUri: ctx.redirectUri },
      };
    },

    async handleCallback(creds, params, transient) {
      if (!params.state || params.state !== transient.state) {
        throw new SsoCallbackError("state mismatch");
      }
      const { clientId, tenantId } = cfg(creds);
      if (!creds.clientSecret) {
        throw new SsoCallbackError("missing client secret");
      }

      let res: Response;
      try {
        res = await doFetch(endpoints(tenantId).token, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            grant_type: "authorization_code",
            code: params.code,
            redirect_uri: transient.redirectUri,
            code_verifier: transient.codeVerifier,
            client_secret: creds.clientSecret,
          }).toString(),
        });
      } catch (err) {
        throw new SsoCallbackError(
          `token exchange request failed: ${(err as Error).message}`
        );
      }
      if (!res.ok) {
        throw new SsoCallbackError(`token exchange failed (${res.status})`);
      }
      const token = (await res.json()) as { id_token?: string };
      if (!token.id_token) {
        throw new SsoCallbackError("token response missing id_token");
      }

      let sub: unknown;
      let tokenNonce: unknown;
      let claimValue: unknown;
      const identityClaim = cfg(creds).identityClaim;
      try {
        const { payload } = await jwtVerify(token.id_token, getJwks(tenantId), {
          issuer: endpoints(tenantId).issuer,
          audience: clientId,
        });
        sub = payload.sub;
        tokenNonce = payload.nonce;
        if (identityClaim) claimValue = payload[identityClaim];
      } catch (err) {
        throw new SsoCallbackError(
          `id_token verification failed: ${(err as Error).message}`
        );
      }
      if (tokenNonce !== transient.nonce) {
        throw new SsoCallbackError("nonce mismatch");
      }
      if (typeof sub !== "string" || !sub) {
        throw new SsoCallbackError("id_token missing sub");
      }
      return {
        subjectId: sub,
        // Fail soft: a configured claim the token doesn't carry (or carries as
        // a non-string) yields no value, never a failed sign-in.
        ...(typeof claimValue === "string" && claimValue
          ? { identityClaimValue: claimValue }
          : {}),
      };
    },

    logoutUrl(creds, ctx) {
      const { tenantId } = cfg(creds);
      const url = new URL(endpoints(tenantId).logout);
      url.search = new URLSearchParams({
        post_logout_redirect_uri: ctx.postLogoutRedirectUri,
      }).toString();
      return url.toString();
    },

    async validate(creds) {
      const { clientId, tenantId } = cfg(creds);
      if (!clientId || !tenantId) {
        return { ok: false, error: "Client ID and Tenant ID are required." };
      }
      if (!creds.clientSecret) {
        return { ok: false, error: "Client secret is required." };
      }
      // A client-credentials round-trip proves client id + secret + tenant are
      // valid: Entra issues a token for the `.default` scope for any correctly
      // registered app (even with no Graph permissions), and returns an AADSTS
      // error otherwise. No user login needed.
      let res: Response;
      try {
        res = await doFetch(endpoints(tenantId).token, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            grant_type: "client_credentials",
            scope: "https://graph.microsoft.com/.default",
            client_secret: creds.clientSecret,
          }).toString(),
        });
      } catch (err) {
        return {
          ok: false,
          error: `Could not reach Microsoft Entra: ${(err as Error).message}`,
        };
      }
      if (res.ok) return { ok: true };
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error_description?: string };
        if (body.error_description) {
          detail = body.error_description.split("\n")[0].trim();
        }
      } catch {
        // keep the status-code fallback
      }
      return { ok: false, error: detail };
    },
  };
}

/** The default Entra provider (real network). */
export const entraProvider = createEntraProvider();
