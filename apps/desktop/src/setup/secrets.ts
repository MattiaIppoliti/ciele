// Every secret the local stack needs, generated here so the user never opens
// an env file.
//
// This is `deploy/bootstrap.sh`'s secret block, in TypeScript, over a crypto
// port. Not a call out to the shell script: the app has to run where bash and
// openssl may not be on a GUI process's PATH, and the failure mode of getting
// this wrong is a stack that starts and then rejects every request with a 401
// nobody can explain. Being able to test it is the point.
//
// The one rule to keep in step with bootstrap.sh: ANON_KEY and
// SERVICE_ROLE_KEY are HS256 JWTs signed with this install's own JWT_SECRET.
// They are not credentials looked up anywhere — they are claims this
// deployment signs for itself — which is exactly why no published image can
// carry them and why the app must mint them per install.

import type { CryptoPort, ClockPort } from "./ports";

/** Ten years. Rotating these means rotating JWT_SECRET, a deliberate act. */
const KEY_LIFETIME_SECONDS = 315_360_000;

export interface StackSecrets {
  postgresPassword: string;
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
  appEncryptionKey: string;
  cronSecret: string;
}

export function generateStackSecrets(crypto: CryptoPort, clock: ClockPort): StackSecrets {
  // Hex, not base64: this one is interpolated into the userinfo section of a
  // Postgres connection string, where a stray `@`, `:` or `/` would silently
  // truncate the URL and point the app at the wrong host.
  const postgresPassword = hex(crypto.randomBytes(32));
  const jwtSecret = hex(crypto.randomBytes(32));
  return {
    postgresPassword,
    jwtSecret,
    anonKey: mintKey("anon", jwtSecret, crypto, clock),
    serviceRoleKey: mintKey("service_role", jwtSecret, crypto, clock),
    // AES-256-GCM seals provider keys at rest, so this must be exactly 32 bytes.
    appEncryptionKey: base64(crypto.randomBytes(32)),
    cronSecret: hex(crypto.randomBytes(32)),
  };
}

export function mintKey(
  role: string,
  jwtSecret: string,
  crypto: CryptoPort,
  clock: ClockPort,
): string {
  const issuedAt = clock.nowSeconds();
  const header = base64url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(
    utf8(
      JSON.stringify({
        role,
        iss: "supabase",
        iat: issuedAt,
        exp: issuedAt + KEY_LIFETIME_SECONDS,
      }),
    ),
  );
  const signature = base64url(crypto.hmacSha256(jwtSecret, `${header}.${payload}`));
  return `${header}.${payload}.${signature}`;
}

/**
 * Fill in the env template the app ships, leaving every comment and option
 * visible — the same thing bootstrap.sh does, and for the same reason: a
 * self-hoster who later wants to change something should find a documented
 * file, not a generated one.
 *
 * Only empty `KEY=` lines are filled. A key already carrying a value is left
 * alone, so re-running never overwrites a secret (which would orphan the data
 * that secret protects) or an edit the user made by hand.
 */
export function fillEnvTemplate(template: string, values: Record<string, string>): string {
  return template
    .split("\n")
    .map((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=$/.exec(line);
      if (!match) return line;
      const value = values[match[1]!];
      return value === undefined || value === "" ? line : `${match[1]}=${value}`;
    })
    .join("\n");
}

/** Read a rendered env file back — used to verify and to reuse an existing one. */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]!] = match[2]!;
  }
  return values;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is in every environment this runs in (Electron main, the renderer,
  // node 16+), and avoids a `Buffer` import in a module that must stay free
  // of node builtins.
  return btoa(binary);
}

function base64url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
