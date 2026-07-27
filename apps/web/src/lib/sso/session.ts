import type { SsoProviderKind } from "@agent-hub/core";
import { openSecret, sealSecret } from "@agent-hub/core";

import type { SsoTransient } from "./types";

/**
 * Widget SSO cookies. Both are sealed (AES-256-GCM via `sealSecret`) so their
 * contents are opaque and tamper-evident — the browser only ever holds
 * ciphertext.
 *
 * - `sso_txn` (transient): flow state from `initiate` → callback. Short-lived,
 *   SameSite=Lax (it only needs to survive the top-level redirect back from the
 *   IdP).
 * - `sso_gate` (gate session): proof the visitor authenticated for an org.
 *   SameSite=None so the cross-origin widget iframe sends it to the chat API.
 *
 * Enforcement is per-assistant but the connection (and thus the gate) is
 * org-scoped: signing in once covers every assistant in that org.
 */
export const SSO_TXN_COOKIE = "sso_txn";
export const SSO_GATE_COOKIE = "sso_gate";

/** Transient TTL: long enough to complete an IdP login, short enough to bound replay. */
export const SSO_TXN_MAX_AGE = 10 * 60; // seconds
/** Gate session lifetime. */
export const SSO_GATE_MAX_AGE = 12 * 60 * 60; // seconds

export interface SsoTxnPayload extends SsoTransient {
  assistantId: string;
  organizationId: string;
  provider: SsoProviderKind;
  /** Same-origin URL to return to when the flow runs top-level (popup blocked). */
  returnTo?: string;
}

export interface SsoGatePayload {
  organizationId: string;
  subjectId: string;
  provider: SsoProviderKind;
  /** Unix seconds; the gate is invalid past this even if the cookie lingers. */
  exp: number;
}

/**
 * SSO cookies are a security boundary (a forged gate cookie = a bypassed
 * gate), so they MUST be authenticated-encrypted. `sealSecret` falls back to an
 * unsigned `plain:` value when `APP_ENCRYPTION_KEY` is unset — never acceptable
 * here. We refuse to mint a cookie without the key, and refuse to trust a
 * `plain:` value on read (fail closed).
 */
function requireEncryptionKey(): void {
  if (!process.env.APP_ENCRYPTION_KEY) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required to issue SSO cookies — refusing to mint an unsigned cookie."
    );
  }
}

function openSealed<T>(sealed: string | undefined): T | null {
  if (!sealed || sealed.startsWith("plain:")) return null;
  try {
    return JSON.parse(openSecret(sealed)) as T;
  } catch {
    return null;
  }
}

export function sealTxn(payload: SsoTxnPayload): string {
  requireEncryptionKey();
  return sealSecret(JSON.stringify(payload));
}

export function openTxn(sealed: string | undefined): SsoTxnPayload | null {
  return openSealed<SsoTxnPayload>(sealed);
}

export function sealGate(payload: SsoGatePayload): string {
  requireEncryptionKey();
  return sealSecret(JSON.stringify(payload));
}

export function openGate(sealed: string | undefined): SsoGatePayload | null {
  const payload = openSealed<SsoGatePayload>(sealed);
  if (!payload) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    return null;
  }
  return payload;
}

/**
 * The gate check every widget surface shares: a visitor is authenticated for an
 * assistant when they hold a valid, unexpired gate cookie for that assistant's
 * organization (the connection — and thus the gate — is org-scoped).
 */
export function isGateValidForOrg(
  cookieValue: string | undefined,
  organizationId: string
): boolean {
  const gate = openGate(cookieValue);
  return gate !== null && gate.organizationId === organizationId;
}

type CookieOptions = {
  httpOnly: true;
  secure: true;
  path: string;
  sameSite: "lax" | "none";
  maxAge: number;
};

export const txnCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  path: "/",
  sameSite: "lax",
  maxAge: SSO_TXN_MAX_AGE,
};

export const gateCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  path: "/",
  sameSite: "none",
  maxAge: SSO_GATE_MAX_AGE,
};
