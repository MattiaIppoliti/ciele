import type { SsoConnectionConfig, SsoProviderKind } from "@agent-hub/core";

/**
 * The widget SSO adapter contract (spec #370, ticket #372). One implementation
 * per provider (Entra built; Clerk/WorkOS contract-ready). The whole flow runs
 * server-side on the Node runtime — the IdP is NEVER framed (see
 * docs/research/sso-provider-shapes.md): the widget opens it in a popup /
 * top-level context and our callback route mints a first-party gate cookie.
 */
export interface SsoProvider {
  kind: SsoProviderKind;
  /** Build the authorize handoff and the transient to persist for the callback. */
  initiate(
    creds: SsoCredentials,
    ctx: SsoInitiateContext
  ): Promise<{ authorizationUrl: string; transient: SsoTransient }>;
  /** Exchange the callback, verify, and return ONLY what a gate needs. */
  handleCallback(
    creds: SsoCredentials,
    params: SsoCallbackParams,
    transient: SsoTransient
  ): Promise<SsoAuthResult>;
  /** Optional provider end-session URL; we always also clear our own cookie. */
  logoutUrl?(
    creds: SsoCredentials,
    ctx: { postLogoutRedirectUri: string }
  ): string | null;
  /**
   * Probe the stored credentials without a full user login (e.g. a
   * client-credentials round-trip), so the admin gets a clear pass/fail when
   * connecting. Never throws — validation failure is a result, not an error.
   */
  validate?(creds: SsoCredentials): Promise<SsoValidationResult>;
}

export type SsoValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Everything an adapter needs to run the flow: the non-secret connection config
 * plus the UNSEALED client secret (the route unseals it via `openSecret` before
 * calling the adapter; `null` when no secret is stored).
 */
export interface SsoCredentials {
  config: SsoConnectionConfig;
  clientSecret: string | null;
}

export interface SsoInitiateContext {
  /** The absolute callback URL registered with the provider. */
  redirectUri: string;
}

/**
 * Flow state carried from `initiate` to `handleCallback`. The route seals this
 * into a short-lived HTTP-only cookie keyed to the browser; it never reaches
 * the IdP. `redirectUri` is persisted because the token exchange must send the
 * exact same value it authorized with.
 */
export interface SsoTransient {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface SsoCallbackParams {
  code: string;
  state: string;
}

/**
 * The result a gate needs. `subjectId` is always the verified OIDC `sub`.
 * `identityClaimValue` is present only when the connection opted into an
 * identity claim (config.identityClaim, #662) AND the ID token carried it —
 * a configured-but-missing claim fails soft (sign-in still succeeds; per-user
 * features that need the claim simply stay off for this user).
 */
export interface SsoAuthResult {
  subjectId: string;
  identityClaimValue?: string;
}

/** Thrown by an adapter when a callback cannot be trusted (bad state, invalid token, …). */
export class SsoCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoCallbackError";
  }
}
