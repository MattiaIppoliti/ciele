// Inventory + rotation for legacy plaintext credentials (#801, CYB-02).
//
// The pre-#801 `sealSecret` fell back to writing `plain:<secret>` when
// `APP_ENCRYPTION_KEY` was missing. The fallback is gone and startup now
// refuses a keyless Supabase-backed deployment, but neither changes a row that
// was already written in the clear. This script is the missing lifecycle end:
// it finds those rows and, on request, re-seals them under the current key.
//
//   node scripts/rotate-legacy-secrets.mjs             # inventory, read-only
//   node scripts/rotate-legacy-secrets.mjs --rotate    # re-seal what it found
//
// Environment: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY always; APP_ENCRYPTION_KEY for --rotate.
//
// Deliberately dependency-free (plain fetch against PostgREST, node:crypto for
// the seal), because the root workspace installs no Supabase client and an
// operational one-shot should not change the dependency tree to exist. The
// seal replicates `packages/core/src/crypto.ts` exactly, sha256(key),
// AES-256-GCM, `iv.tag.data` base64, and the test file holds the two
// implementations together with a round-trip vector.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const LEGACY_PREFIX = "plain:";

/** Every text column `sealSecret` writes. Additions to the schema belong here too. */
export const SEALED_TEXT_COLUMNS = [
  { table: "provider_connections", column: "encrypted_key" },
  { table: "sso_connections", column: "encrypted_secret" },
  { table: "assistant_api_integrations", column: "encrypted_credential" },
  // Written by `sealSecret` in apps/web/src/app/actions.ts (the entity sync
  // settings action seals the header list as one JSON blob); read back by
  // `openSecret` in packages/agent/src/entity-sync.ts.
  { table: "entity_sync_configs", column: "sealed_headers" },
  { table: "application_connections", column: "sealed_credentials" },
];

/** The one JSON column with sealed leaves: help_desks.ticketing_integration.config.* */
export const SEALED_JSON_COLUMN = {
  table: "help_desks",
  column: "ticketing_integration",
};

export function isLegacyPlaintextSecret(stored) {
  return typeof stored === "string" && stored.startsWith(LEGACY_PREFIX);
}

/** `packages/core/src/crypto.ts` verbatim: any-string key hashed to 32 bytes. */
function keyBytes(secret) {
  return createHash("sha256").update(secret).digest();
}

export function sealSecret(plaintext, appEncryptionKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(appEncryptionKey), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function openSecret(stored, appEncryptionKey) {
  if (isLegacyPlaintextSecret(stored)) return stored.slice(LEGACY_PREFIX.length);
  const [iv, tag, data] = stored.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(appEncryptionKey),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Re-seals the legacy leaves of one ticketing_integration document. Returns
 * null when nothing in it is legacy, so callers can skip the write. Only
 * `config` values are candidates: that is the only bag `sealSecret` writes
 * into (help-desks.ts), and platform/name must stay readable.
 */
export function rotateTicketingIntegration(integration, appEncryptionKey) {
  if (!integration || typeof integration !== "object") return null;
  const config = integration.config;
  if (!config || typeof config !== "object") return null;
  let changed = false;
  const rotated = {};
  for (const [key, value] of Object.entries(config)) {
    if (isLegacyPlaintextSecret(value)) {
      rotated[key] = sealSecret(value.slice(LEGACY_PREFIX.length), appEncryptionKey);
      changed = true;
    } else {
      rotated[key] = value;
    }
  }
  return changed ? { ...integration, config: rotated } : null;
}

// --- PostgREST plumbing (main only, nothing below is imported by the test) ---

function env(name, fallback) {
  return process.env[name] ?? (fallback ? process.env[fallback] : undefined);
}

/** One PostgREST page. Kept explicit so a capped server answer is never
 * mistaken for the whole table (Supabase defaults max-rows to 1000). */
const PAGE_SIZE = 500;

/**
 * Walks a filtered table page by page, ordered by id so pages are stable.
 * `advance: false` re-reads the first page each round, which is what a
 * mutating pass needs: a PATCH that makes a row stop matching the filter
 * shifts every later offset, and advancing past the shift skips rows.
 */
async function* pages(base, serviceKey, table, params, { advance }) {
  let offset = 0;
  for (;;) {
    const rows = await rest(
      base,
      serviceKey,
      `${table}?${params}&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < PAGE_SIZE && !advance) return;
    if (advance) offset += rows.length;
  }
}

async function rest(base, serviceKey, path, init = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

async function main() {
  const rotate = process.argv.includes("--rotate");
  const base = env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !serviceKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required."
    );
    process.exit(2);
  }
  const appKey = process.env.APP_ENCRYPTION_KEY;
  if (rotate && !appKey) {
    console.error("APP_ENCRYPTION_KEY is required to rotate (it is what the re-seal writes under).");
    process.exit(2);
  }

  let found = 0;
  let rotated = 0;

  for (const { table, column } of SEALED_TEXT_COLUMNS) {
    // `like.plain:*` matches only rows the removed fallback wrote; a sealed
    // value is base64 segments joined by dots and cannot start with "plain:".
    // Rotating a row makes it stop matching, so the rotate pass re-reads the
    // first page until it comes back empty; the inventory pass advances.
    const filter = `select=id,${column}&${column}=like.${encodeURIComponent("plain:*")}`;
    for await (const rows of pages(base, serviceKey, table, filter, { advance: !rotate })) {
      for (const row of rows) {
        found += 1;
        console.log(`${rotate ? "rotating" : "legacy"}: ${table}.${column} id=${row.id}`);
        if (!rotate) continue;
        await rest(base, serviceKey, `${table}?id=eq.${row.id}`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({
            [column]: sealSecret(row[column].slice(LEGACY_PREFIX.length), appKey),
          }),
        });
        rotated += 1;
      }
    }
  }

  const { table, column } = SEALED_JSON_COLUMN;
  // A rotated document stays non-null, so this filter's pages never shift
  // under the PATCHes: always advance.
  const filter = `select=id,${column}&${column}=not.is.null`;
  for await (const desks of pages(base, serviceKey, table, filter, { advance: true })) {
    for (const desk of desks) {
      const next = rotateTicketingIntegration(desk[column], appKey ?? "");
      if (!next) continue;
      found += 1;
      console.log(`${rotate ? "rotating" : "legacy"}: ${table}.${column} id=${desk.id}`);
      if (!rotate) continue;
      await rest(base, serviceKey, `${table}?id=eq.${desk.id}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ [column]: next }),
      });
      rotated += 1;
    }
  }

  if (found === 0) {
    console.log("No legacy plaintext credentials found.");
  } else if (rotate) {
    console.log(`Rotated ${rotated} of ${found} legacy credential row(s).`);
  } else {
    console.log(
      `${found} legacy credential row(s) found. Re-run with --rotate (APP_ENCRYPTION_KEY set) to re-seal them.`
    );
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
