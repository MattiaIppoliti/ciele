import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const NONCE_BYTES = 16;
const SIGNATURE_BYTES = 16;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNING_CONTEXT = "ciele-local-connector-pairing-v1\0";

export class InvalidRelayPairingCodeError extends Error {
  constructor() {
    super("Pairing code is invalid or expired.");
    this.name = "InvalidRelayPairingCodeError";
  }
}

function signature(input: {
  nonce: Uint8Array;
  origin: string;
  secret: string;
}) {
  return createHmac("sha256", input.secret)
    .update(SIGNING_CONTEXT)
    .update(input.origin)
    .update("\0")
    .update(input.nonce)
    .digest()
    .subarray(0, SIGNATURE_BYTES);
}

export function createRelayPairingCode(input: {
  origin: string;
  secret: string;
}): string {
  const nonce = randomBytes(NONCE_BYTES);
  return Buffer.concat([nonce, signature({ ...input, nonce })]).toString(
    "base64url"
  );
}

export function verifyRelayPairingCode(input: {
  code: string;
  origin: string;
  secret: string;
}): boolean {
  if (!CODE_PATTERN.test(input.code)) return false;

  const decoded = Buffer.from(input.code, "base64url");
  if (decoded.byteLength !== NONCE_BYTES + SIGNATURE_BYTES) return false;

  const nonce = decoded.subarray(0, NONCE_BYTES);
  const provided = decoded.subarray(NONCE_BYTES);
  const expected = signature({ ...input, nonce });
  return timingSafeEqual(provided, expected);
}
