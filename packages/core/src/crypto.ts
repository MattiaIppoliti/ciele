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

function decryptWith(ciphertext: string, keyBytes: Buffer): string {
  const [iv, tag, data] = ciphertext.split(".");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes, Buffer.from(iv, "base64"));
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
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

/**
 * Opens a sealed value under the current key, then under
 * `APP_ENCRYPTION_KEY_PREVIOUS` when one is set. That second key is what makes
 * rotation possible at all: one key sealed every credential, so replacing it
 * outright left every row undecryptable. The stored format stays `iv.tag.data`
 * with no key id, so code from before this change still reads anything
 * written after it; GCM's tag is what tells a wrong key from a right one.
 * Rotate by moving the old value to `_PREVIOUS`, setting the new one, and
 * running `node scripts/rotate-legacy-secrets.mjs --rekey`.
 */
export function openSecret(stored: string): string {
  if (isLegacyPlaintextSecret(stored)) {
    return stored.slice(LEGACY_PLAINTEXT_PREFIX.length);
  }
  try {
    return decryptWith(stored, key());
  } catch (error) {
    const previous = process.env.APP_ENCRYPTION_KEY_PREVIOUS;
    if (!previous) throw error;
    return decryptWith(stored, createHash("sha256").update(previous).digest());
  }
}
