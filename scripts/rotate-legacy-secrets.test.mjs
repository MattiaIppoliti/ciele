// Tests for the legacy-plaintext credential rotation (#801, CYB-02).
// Plain node + assert, matching the repo's script-test convention:
//   node scripts/rotate-legacy-secrets.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SEALED_TEXT_COLUMNS,
  isLegacyPlaintextSecret,
  openSecret,
  rekeySealedValue,
  rekeyTicketingIntegration,
  rotateTicketingIntegration,
  sealSecret,
} from "./rotate-legacy-secrets.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok, ${label}`);
}

const KEY = "the app encryption key, any string";

check("seal/open round-trips under the same key", () => {
  const sealed = sealSecret("sk-super-secret", KEY);
  assert.equal(openSecret(sealed, KEY), "sk-super-secret");
  assert.ok(!isLegacyPlaintextSecret(sealed));
  // The core layout: three base64 segments joined by dots.
  assert.equal(sealed.split(".").length, 3);
});

check("a sealed value cannot collide with the legacy prefix", () => {
  // base64 alphabet has no ':' before the first dot, so `like.plain:*`
  // can never match a properly sealed row.
  for (let i = 0; i < 20; i++) {
    assert.ok(!sealSecret("x".repeat(i + 1), KEY).startsWith("plain:"));
  }
});

check("openSecret still reads a legacy row, which is what rotation preserves", () => {
  assert.equal(openSecret("plain:hunter2", KEY), "hunter2");
});

check("rotateTicketingIntegration re-seals only legacy config leaves", () => {
  const sealedAlready = sealSecret("kept", KEY);
  const next = rotateTicketingIntegration(
    {
      platform: "servicenow",
      name: "Prod",
      config: {
        baseUrl: "https://x.service-now.com",
        clientId: "abc",
        clientSecret: "plain:s3cret",
        username: "svc",
        password: sealedAlready,
      },
    },
    KEY
  );
  assert.ok(next, "a legacy leaf means a rewrite");
  assert.equal(next.platform, "servicenow");
  assert.equal(next.config.baseUrl, "https://x.service-now.com");
  assert.equal(next.config.password, sealedAlready, "already-sealed leaves untouched");
  assert.ok(!isLegacyPlaintextSecret(next.config.clientSecret));
  assert.equal(openSecret(next.config.clientSecret, KEY), "s3cret");
});

check("rotateTicketingIntegration returns null when nothing is legacy", () => {
  assert.equal(rotateTicketingIntegration(null, KEY), null);
  assert.equal(rotateTicketingIntegration({ platform: "servicenow" }, KEY), null);
  assert.equal(
    rotateTicketingIntegration(
      { config: { clientSecret: sealSecret("s", KEY) } },
      KEY
    ),
    null
  );
});

check("the seal replicates packages/core/src/crypto.ts, not a variant of it", () => {
  // The script cannot import the TS package, so hold the two implementations
  // together structurally: the core file must still hash the key with sha256,
  // still use aes-256-gcm, and still join iv.tag.data with dots. If any of
  // that changes, this test points at the script needing the same change.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const core = readFileSync(
    path.join(here, "..", "packages", "core", "src", "crypto.ts"),
    "utf8"
  );
  for (const marker of [
    'createHash("sha256")',
    '"aes-256-gcm"',
    "randomBytes(12)",
    "${iv.toString(\"base64\")}.${tag.toString(\"base64\")}.${data.toString(\"base64\")}",
    'LEGACY_PLAINTEXT_PREFIX = "plain:"',
  ]) {
    assert.ok(core.includes(marker), `core crypto.ts lost marker: ${marker}`);
  }
});

check("the column inventory names every sealed text column the schema has", () => {
  const named = SEALED_TEXT_COLUMNS.map((c) => `${c.table}.${c.column}`).sort();
  assert.deepEqual(named, [
    "application_connections.sealed_credentials",
    "assistant_api_integrations.encrypted_credential",
    "entity_sync_configs.sealed_headers",
    "provider_connections.encrypted_key",
    "sso_connections.encrypted_secret",
  ]);
});

const NEW_KEY = "the replacement key";

check("rekey moves a value from the previous key to the current one", () => {
  const old = sealSecret("sk-move-me", KEY);
  const next = rekeySealedValue(old, NEW_KEY, KEY);
  assert.ok(next);
  assert.equal(openSecret(next, NEW_KEY), "sk-move-me");
  assert.throws(() => openSecret(next, KEY));
});

check("rekey leaves a value already under the current key, and plaintext, alone", () => {
  assert.equal(rekeySealedValue(sealSecret("sk-fine", NEW_KEY), NEW_KEY, KEY), null);
  assert.equal(rekeySealedValue("plain:sk-legacy", NEW_KEY, KEY), null);
});

check("rekey refuses a value neither key opens rather than skipping it", () => {
  assert.throws(() => rekeySealedValue(sealSecret("x", "a third key"), NEW_KEY, KEY));
});

check("rekey reaches the sealed leaves of a ticketing integration only", () => {
  const next = rekeyTicketingIntegration(
    { platform: "servicenow", config: { password: sealSecret("pw", KEY), instance: "acme" } },
    NEW_KEY,
    KEY
  );
  assert.equal(next.platform, "servicenow");
  assert.equal(next.config.instance, "acme");
  assert.equal(openSecret(next.config.password, NEW_KEY), "pw");
});

console.log(`${passed} checks passed`);
