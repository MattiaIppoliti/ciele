import { describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  type JWK,
} from "jose";
import { createEntraProvider } from "./entra";
import { SsoCallbackError, type SsoCredentials, type SsoTransient } from "./types";

const TENANT = "tenant-123";
const CLIENT_ID = "client-abc";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const SUB = "visitor-sub-1";

const creds: SsoCredentials = {
  config: { clientId: CLIENT_ID, tenantId: TENANT },
  clientSecret: "sealed-but-unsealed-here",
};

const transient: SsoTransient = {
  state: "state-xyz",
  nonce: "nonce-xyz",
  codeVerifier: "verifier-xyz",
  redirectUri: "https://platform.ciele.app/api/sso/entra/callback",
};

/** A signing key whose public JWK feeds the adapter's (injected) JWKS. */
async function keyMaterial() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.alg = "RS256";
  const jwks = createLocalJWKSet({ keys: [jwk] }) as JWTVerifyGetKey;
  return { privateKey, jwks };
}

async function signIdToken(
  privateKey: CryptoKey,
  claims: {
    aud?: string;
    nonce?: string;
    expired?: boolean;
    extra?: Record<string, unknown>;
  } = {}
) {
  const jwt = new SignJWT({
    nonce: claims.nonce ?? transient.nonce,
    ...claims.extra,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setAudience(claims.aud ?? CLIENT_ID)
    .setSubject(SUB)
    .setIssuedAt();
  jwt.setExpirationTime(claims.expired ? "-1h" : "1h");
  return jwt.sign(privateKey);
}

/** A fetch stub that returns the given id_token from the token endpoint. */
function tokenFetch(idToken: string | null, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 400,
      json: async () => (idToken ? { id_token: idToken } : {}),
    }) as Response) as unknown as typeof fetch;
}

describe("Entra SSO adapter", () => {
  describe("initiate", () => {
    it("builds an authorize URL with PKCE and openid scope", async () => {
      const provider = createEntraProvider();
      const { authorizationUrl, transient: t } = await provider.initiate(creds, {
        redirectUri: transient.redirectUri,
      });
      const url = new URL(authorizationUrl);
      expect(url.origin + url.pathname).toBe(
        `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
      );
      const q = url.searchParams;
      expect(q.get("client_id")).toBe(CLIENT_ID);
      expect(q.get("response_type")).toBe("code");
      expect(q.get("redirect_uri")).toBe(transient.redirectUri);
      expect(q.get("scope")).toBe("openid");
      expect(q.get("code_challenge_method")).toBe("S256");
      expect(q.get("code_challenge")).toBeTruthy();
      expect(q.get("state")).toBe(t.state);
      expect(q.get("nonce")).toBe(t.nonce);
      // The verifier stays server-side (only its challenge is on the wire).
      expect(q.get("code_challenge")).not.toBe(t.codeVerifier);
      expect(t.redirectUri).toBe(transient.redirectUri);
    });

    it("widens the scope when an identity claim is configured (#662)", async () => {
      const provider = createEntraProvider();
      const { authorizationUrl } = await provider.initiate(
        { ...creds, config: { ...creds.config, identityClaim: "email" } },
        { redirectUri: transient.redirectUri }
      );
      expect(new URL(authorizationUrl).searchParams.get("scope")).toBe(
        "openid profile email"
      );
    });
  });

  describe("handleCallback", () => {
    it("exchanges the code and returns sub from a valid id_token", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey);
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      const result = await provider.handleCallback(
        creds,
        { code: "auth-code", state: transient.state },
        transient
      );
      expect(result).toEqual({ subjectId: SUB });
    });

    it("returns the configured identity claim when the token carries it (#662)", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey, {
        extra: { email: "person@example.com" },
      });
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      const result = await provider.handleCallback(
        { ...creds, config: { ...creds.config, identityClaim: "email" } },
        { code: "auth-code", state: transient.state },
        transient
      );
      expect(result).toEqual({
        subjectId: SUB,
        identityClaimValue: "person@example.com",
      });
    });

    it("fails soft when the configured claim is missing from the token", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey); // no email claim
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      const result = await provider.handleCallback(
        { ...creds, config: { ...creds.config, identityClaim: "email" } },
        { code: "auth-code", state: transient.state },
        transient
      );
      expect(result).toEqual({ subjectId: SUB });
    });

    it("ignores token claims when no identity claim is configured", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey, {
        extra: { email: "person@example.com" },
      });
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      const result = await provider.handleCallback(
        creds,
        { code: "auth-code", state: transient.state },
        transient
      );
      expect(result).toEqual({ subjectId: SUB });
    });

    it("rejects a state mismatch before any exchange", async () => {
      const provider = createEntraProvider({
        fetch: tokenFetch("unused"),
        jwks: () => (async () => {
          throw new Error("should not verify");
        }) as unknown as JWTVerifyGetKey,
      });
      await expect(
        provider.handleCallback(
          creds,
          { code: "c", state: "WRONG" },
          transient
        )
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });

    it("rejects a wrong audience", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey, { aud: "someone-else" });
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      await expect(
        provider.handleCallback(creds, { code: "c", state: transient.state }, transient)
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });

    it("rejects a mismatched nonce", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey, { nonce: "not-the-nonce" });
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      await expect(
        provider.handleCallback(creds, { code: "c", state: transient.state }, transient)
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });

    it("rejects an expired id_token", async () => {
      const { privateKey, jwks } = await keyMaterial();
      const idToken = await signIdToken(privateKey, { expired: true });
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => jwks,
      });
      await expect(
        provider.handleCallback(creds, { code: "c", state: transient.state }, transient)
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });

    it("rejects a bad signature (key not in the JWKS)", async () => {
      const signer = await keyMaterial(); // signs the token
      const verifier = await keyMaterial(); // different key set for verification
      const idToken = await signIdToken(signer.privateKey);
      const provider = createEntraProvider({
        fetch: tokenFetch(idToken),
        jwks: () => verifier.jwks,
      });
      await expect(
        provider.handleCallback(creds, { code: "c", state: transient.state }, transient)
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });

    it("rejects when the token exchange itself fails", async () => {
      const { jwks } = await keyMaterial();
      const provider = createEntraProvider({
        fetch: tokenFetch(null, false),
        jwks: () => jwks,
      });
      await expect(
        provider.handleCallback(creds, { code: "c", state: transient.state }, transient)
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });

    it("rejects when no client secret is available", async () => {
      const { jwks } = await keyMaterial();
      const provider = createEntraProvider({
        fetch: tokenFetch("unused"),
        jwks: () => jwks,
      });
      await expect(
        provider.handleCallback(
          { ...creds, clientSecret: null },
          { code: "c", state: transient.state },
          transient
        )
      ).rejects.toBeInstanceOf(SsoCallbackError);
    });
  });

  describe("validate", () => {
    const okFetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ access_token: "t" }) }) as Response) as unknown as typeof fetch;

    it("passes when the client-credentials probe succeeds", async () => {
      const provider = createEntraProvider({ fetch: okFetch });
      expect(await provider.validate!(creds)).toEqual({ ok: true });
    });

    it("fails with the AADSTS error detail on rejection", async () => {
      const fetchStub = (async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({
            error_description: "AADSTS7000215: Invalid client secret provided.\nTrace ID: x",
          }),
        }) as Response) as unknown as typeof fetch;
      const provider = createEntraProvider({ fetch: fetchStub });
      const result = await provider.validate!(creds);
      expect(result).toEqual({
        ok: false,
        error: "AADSTS7000215: Invalid client secret provided.",
      });
    });

    it("fails without throwing when the probe request errors", async () => {
      const fetchStub = (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      const provider = createEntraProvider({ fetch: fetchStub });
      const result = await provider.validate!(creds);
      expect(result.ok).toBe(false);
    });

    it("fails when no client secret is present", async () => {
      const provider = createEntraProvider({ fetch: okFetch });
      const result = await provider.validate!({ ...creds, clientSecret: null });
      expect(result.ok).toBe(false);
    });
  });
});
