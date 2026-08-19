// Standalone test for the dependency-license gate's pure logic.
// Matches the repo's script-test convention (plain node + assert, run
// directly). Run with:
//   node scripts/check-dependency-licenses.test.mjs

import assert from "node:assert/strict";
import {
  DEFAULT_DENYLIST,
  findLicenseViolations,
  isDeniedExpression,
} from "./check-dependency-licenses.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok, ${label}`);
}

// --- isDeniedExpression ---

check("permissive licenses are allowed", () => {
  for (const l of ["MIT", "ISC", "Apache-2.0", "BSD-3-Clause", "0BSD"]) {
    assert.equal(isDeniedExpression(l), false, l);
  }
});

check("compatible copyleft is allowed", () => {
  for (const l of ["GPL-3.0-or-later", "LGPL-3.0-or-later", "MPL-2.0"]) {
    assert.equal(isDeniedExpression(l), false, l);
  }
});

check("GPL-2.0-only is denied but GPL-3.0 is not", () => {
  assert.equal(isDeniedExpression("GPL-2.0-only"), true);
  assert.equal(isDeniedExpression("GPL-3.0-only"), false);
});

check("bare GPL-2.0 is denied as exactly-v2", () => {
  assert.equal(isDeniedExpression("GPL-2.0"), true);
  assert.equal(isDeniedExpression("gpl-2"), true);
});

check("GPL-2.0-or-later and LGPL-2.x are compatible, not denied", () => {
  for (const l of [
    "GPL-2.0-or-later",
    "LGPL-2.0-only",
    "LGPL-2.0-or-later",
    "LGPL-2.1-only",
    "LGPL-2.1-or-later",
  ]) {
    assert.equal(isDeniedExpression(l), false, l);
  }
});

check("source-available licenses are denied", () => {
  for (const l of ["SSPL-1.0", "BUSL-1.1", "FSL-1.1-MIT"]) {
    assert.equal(isDeniedExpression(l), true, l);
  }
});

check("OR expression is allowed when any operand is permissive", () => {
  assert.equal(isDeniedExpression("(MIT OR GPL-3.0-or-later)"), false);
  assert.equal(isDeniedExpression("(SSPL-1.0 OR MIT)"), false);
});

check("OR expression is denied only when every operand is denied", () => {
  assert.equal(isDeniedExpression("(SSPL-1.0 OR BUSL-1.1)"), true);
});

check("AND expression is denied when any operand is denied", () => {
  assert.equal(isDeniedExpression("(MIT AND GPL-2.0-only)"), true);
  assert.equal(isDeniedExpression("Apache-2.0 AND LGPL-3.0-or-later"), false);
});

check("empty / missing license is not a violation here", () => {
  assert.equal(isDeniedExpression(""), false);
  assert.equal(isDeniedExpression(undefined), false);
});

// --- findLicenseViolations (pnpm licenses list --json shape) ---

check("a clean workspace map yields no violations", () => {
  const map = {
    MIT: [{ name: "a", versions: ["1.0.0"] }],
    "Apache-2.0": [{ name: "b", versions: ["2.0.0"] }],
    "(MIT OR GPL-3.0-or-later)": [{ name: "c", versions: ["3.0.0"] }],
    "Apache-2.0 AND LGPL-3.0-or-later": [{ name: "sharp", versions: ["0.34.5"] }],
  };
  assert.deepEqual(findLicenseViolations(map), []);
});

check("denied deps are reported with name and license", () => {
  const map = {
    MIT: [{ name: "ok", versions: ["1.0.0"] }],
    "SSPL-1.0": [{ name: "mongo-thing", versions: ["6.0.0"] }],
    "BUSL-1.1": [{ name: "cockroach-thing", versions: ["23.1.0"] }],
  };
  const v = findLicenseViolations(map);
  assert.equal(v.length, 2);
  const names = v.map((x) => x.package).sort();
  assert.deepEqual(names, ["cockroach-thing", "mongo-thing"]);
  assert.ok(v.every((x) => x.license && x.package));
});

check("denylist covers the licensing decision", () => {
  for (const token of ["SSPL", "BUSL", "FSL", "Commons-Clause", "Sustainable-Use", "GPL-2.0-only"]) {
    assert.ok(DEFAULT_DENYLIST.includes(token), token);
  }
});

console.log(`\n${passed} checks passed.`);
