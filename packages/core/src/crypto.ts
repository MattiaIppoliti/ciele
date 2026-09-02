import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM for BYOK provider keys. APP_ENCRYPTION_KEY (any string) is
 * hashed to the 32-byte key. Ciphertext layout: iv.tag.data (base64, dot-sep).
 */
function key(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set, required to store or read a credential."
    );
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * The marker the pre-#801 no-key fallback wrote. Nothing produces it any more;
 * `openSecret` still reads it so an install that sets a key for the first time
 * can re-seal what it already has instead of losing it.
 */
const LEGACY_PLAINTEXT_PREFIX = "plain:";

/** True for a credential row written by that removed fallback. */
export function isLegacyPlaintextSecret(stored: string): boolean {
  return stored.startsWith(LEGACY_PLAINTEXT_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const [iv, tag, data] = ciphertext.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Seals a credential for storage. Fail-closed (#801, CYB-02): without
 * `APP_ENCRYPTION_KEY` this throws, so a deployment that forgot the variable
 * refuses to save the credential instead of writing it in the clear and
 * warning to a log nobody reads. The old fallback covered provider, SSO,
 * help-desk, API-integration and application OAuth secrets, so every one of
 * them could sit unencrypted for the life of the install.
 */
export function sealSecret(plaintext: string): string {
  return encryptSecret(plaintext);
}

export function openSecret(stored: string): string {
  if (isLegacyPlaintextSecret(stored)) {
    return stored.slice(LEGACY_PLAINTEXT_PREFIX.length);
  }
  return decryptSecret(stored);
}
