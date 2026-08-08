import type { SsoProviderKind } from "@agent-hub/core";
import { entraProvider } from "./entra";
import type { SsoProvider } from "./types";

export type {
  SsoProvider,
  SsoCredentials,
  SsoInitiateContext,
  SsoTransient,
  SsoCallbackParams,
  SsoAuthResult,
  SsoValidationResult,
} from "./types";
export { SsoCallbackError } from "./types";
export { createEntraProvider, entraProvider } from "./entra";
export {
  SSO_TXN_COOKIE,
  SSO_GATE_COOKIE,
  SSO_TXN_MAX_AGE,
  SSO_GATE_MAX_AGE,
  sealTxn,
  openTxn,
  sealGate,
  openGate,
  isGateValidForOrg,
  gateForOrg,
  txnCookieOptions,
  gateCookieOptions,
  type SsoTxnPayload,
  type SsoGatePayload,
} from "./session";

/** Every provider kind the URL space accepts (one source of truth for the routes). */
export const SSO_PROVIDER_KINDS: readonly SsoProviderKind[] = [
  "entra",
  "clerk",
  "workos",
];

export function isKnownProviderKind(value: string): value is SsoProviderKind {
  return (SSO_PROVIDER_KINDS as readonly string[]).includes(value);
}

/** Providers with a shipped adapter. Clerk/WorkOS are contract-ready, not built. */
const PROVIDERS: Partial<Record<SsoProviderKind, SsoProvider>> = {
  entra: entraProvider,
};

/** The adapter for a provider kind, or `null` when it isn't built yet. */
export function getSsoProvider(kind: SsoProviderKind): SsoProvider | null {
  return PROVIDERS[kind] ?? null;
}
