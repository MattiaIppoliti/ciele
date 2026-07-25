import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM for BYOK provider keys. APP_ENCRYPTION_KEY (any string) is
 * hashed to the 32-byte key. Ciphertext layout: iv.tag.data (base64, dot-sep).
 */
function key(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set — required to store provider API keys."
    );
  }
  return createHash("sha256").update(secret).digest();
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

/** Encrypts when APP_ENCRYPTION_KEY is set; falls back to a marked plaintext otherwise. */
export function sealSecret(plaintext: string): string {
  if (!process.env.APP_ENCRYPTION_KEY) {
    console.warn(
      "APP_ENCRYPTION_KEY not set — storing provider key UNENCRYPTED. Set it in production."
    );
    return `plain:${plaintext}`;
  }
  return encryptSecret(plaintext);
}

export function openSecret(stored: string): string {
  if (stored.startsWith("plain:")) return stored.slice(6);
  return decryptSecret(stored);
}
