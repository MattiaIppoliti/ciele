// Contract test for the migration applier (#810).
//
// The applier is bash and needs a database, so CI's migrations gate is where
// it really runs. What this pins is the one promise a gate on the
// supabase/postgres image cannot see: that the script tells PostgREST to
// reload its schema cache itself. The image's superuser-only event triggers do
// that on every DDL and mask a missing NOTIFY; any other Postgres has none.
//
// Plain node + assert, matching the repo's script-test convention:
//   node scripts/apply-migrations.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.join(here, "apply-migrations.sh"), "utf8");

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok, ${label}`);
}

check("the applier notifies PostgREST after the chain", () => {
  const notify = /"\$\{PSQL\[@\]\}" -c "notify pgrst, 'reload schema';"/;
  assert.match(script, notify, "apply-migrations.sh must NOTIFY pgrst after applying");
  // After both chains, not inside the per-file loop: one reload, after the
  // last DDL, whatever the file count.
  const lastApply = script.lastIndexOf('apply_dir "$EE_MIGRATIONS_DIR"');
  const notifyAt = script.search(notify);
  assert.ok(lastApply > 0, "the EE chain call moved; update this test");
  assert.ok(notifyAt > lastApply, "the NOTIFY must come after the last apply_dir call");
});

check("the NOTIFY is unconditional, a run with nothing pending still reloads", () => {
  const notifyAt = script.search(/notify pgrst, 'reload schema'/);
  const pendingCheck = script.indexOf("if [[ $pending -eq 0 ]]; then");
  assert.ok(pendingCheck > 0, "the pending summary moved; update this test");
  assert.ok(
    notifyAt < pendingCheck,
    "the NOTIFY must not sit inside the pending branch; a no-op run still confirms the cache"
  );
});

console.log(`\n${passed} checks passed.`);
