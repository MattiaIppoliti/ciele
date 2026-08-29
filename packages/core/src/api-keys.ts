import { createHash, randomBytes } from "crypto";

/**
 * Organization API key secrets (#618). Pure helpers shared by the web app
 * (mint + display) and, later, the /api/v1 auth layer (verify): the secret is
 * generated once, only its SHA-256 hash is ever stored, and verification is a
 * hash lookup, no plaintext comparison, no decryption path.
 */

export const API_KEY_PREFIX = "ciele_sk_";

/** How many characters of the secret are kept as the displayable hint. */
const HINT_LENGTH = API_KEY_PREFIX.length + 4;

/** A fresh secret: `ciele_sk_` + 192 bits of URL-safe randomness. */
export function generateApiKeySecret(): string {
  return API_KEY_PREFIX + randomBytes(24).toString("base64url");
}

/** The stored (and looked-up) form of a secret. Deterministic, hex. */
export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** The first characters of a secret, safe to persist and display in lists. */
export function apiKeySecretHint(secret: string): string {
  return secret.slice(0, HINT_LENGTH);
}
