// Dependency-license gate for the open-source distribution.
//
// Ciele's core is AGPL-3.0-only. Both the public mirror and the shipped
// Next.js client bundle are *distribution* events, so the dependency policy
// must assume conveyance, the SaaS "loophole" does not apply here.
//
// This denies licenses that are either incompatible with distributing an
// AGPL-3.0 work (GPL-2.0-only) or carry use restrictions that make them
// non-open-source regardless of compatibility (SSPL, BUSL, FSL,
// Commons-Clause, Sustainable-Use). Permissive licenses (MIT/ISC/BSD/
// Apache-2.0) and compatible copyleft (GPL-3.0/LGPL/MPL-2.0) are allowed.
//
// Pure logic (findLicenseViolations / isDeniedExpression) is separated from
// the `pnpm licenses list` I/O so it can be unit-tested without a workspace.

import { execSync } from "node:child_process";

// Denied SPDX identifiers / tokens. Non-GPL tokens are matched
// case-insensitively as substrings of each operand so version suffixes
// (e.g. "BUSL-1.1", "SSPL-1.0") are caught; the GPL-2.0 tokens are matched
// anchored (see GPL2_NO_LATER below) so compatible neighbours never match.
export const DEFAULT_DENYLIST = [
  "GPL-2.0-only",
  "GPL-2.0",
  "SSPL",
  "BUSL",
  "FSL",
  "Commons-Clause",
  "Sustainable-Use",
];

// GPL-2.0 with no "or later" reach is what's incompatible with AGPL-3.0.
// Anchored so the denial never spills onto compatible neighbours:
// GPL-2.0-or-later / GPL-2.0+ upgrade to GPLv3, and LGPL-2.x grants a
// GPL-upgrade path, all of those are allowed. Bare "GPL-2.0" (old packages
// predating the -only suffix) is treated as exactly-v2, i.e. denied.
const GPL2_NO_LATER = /^gpl-2(\.0)?(-only)?$/;

// A single operand is denied if it is exactly-GPL-2.0 or contains any
// non-GPL denylist token.
function isDeniedOperand(operand, denyList) {
  const o = operand.trim().toLowerCase();
  if (!o || o === "and" || o === "or") return false;
  if (GPL2_NO_LATER.test(o)) return true;
  return denyList.some((token) => {
    const t = token.toLowerCase();
    // GPL-2.0 tokens are handled by the anchored regex above, substring
    // matching them would false-deny LGPL-2.x and GPL-2.0-or-later.
    if (t.startsWith("gpl-2")) return false;
    return o.includes(t);
  });
}

// Evaluate an SPDX expression. OR means the consumer may pick any operand,
// so it is a violation only if EVERY operand is denied. AND (or a single
// license) is a violation if ANY operand is denied.
export function isDeniedExpression(expression, denyList = DEFAULT_DENYLIST) {
  if (!expression) return false;
  const normalized = expression.replace(/[()]/g, " ");
  const hasOr = /\bor\b/i.test(normalized);
  const operands = normalized
    .split(/\s+(?:AND|OR)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (operands.length === 0) return false;
  if (hasOr && !/\band\b/i.test(normalized)) {
    // pure OR expression: denied only if no permissive choice exists
    return operands.every((op) => isDeniedOperand(op, denyList));
  }
  // single license, or AND (all must be satisfiable): denied if any is denied
  return operands.some((op) => isDeniedOperand(op, denyList));
}

// licenseMap: { "<license string>": [{ name, versions, ... }, ...] },
// the shape emitted by `pnpm licenses list --json`.
// Returns [{ package, version, license }] for every denied dependency.
export function findLicenseViolations(licenseMap, denyList = DEFAULT_DENYLIST) {
  const violations = [];
  for (const [license, pkgs] of Object.entries(licenseMap || {})) {
    if (!isDeniedExpression(license, denyList)) continue;
    for (const pkg of pkgs || []) {
      violations.push({
        package: pkg.name ?? "(unknown)",
        version: Array.isArray(pkg.versions) ? pkg.versions.join(", ") : "",
        license,
      });
    }
  }
  return violations;
}

function readWorkspaceLicenses() {
  // execSync (shell) so the platform resolves pnpm's launcher, on Windows
  // that is `pnpm.cmd`, which execFileSync would not find on PATH.
  const out = execSync("pnpm licenses list --json", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function main() {
  let licenseMap;
  try {
    licenseMap = readWorkspaceLicenses();
  } catch (err) {
    console.error("Failed to read dependency licenses:", err.message);
    process.exit(2);
  }
  const violations = findLicenseViolations(licenseMap);
  if (violations.length === 0) {
    console.log("Dependency license check passed, no denied licenses found.");
    return;
  }
  console.error("Denied dependency licenses found:\n");
  for (const v of violations) {
    console.error(`  ${v.package}@${v.version}, ${v.license}`);
  }
  console.error(
    `\n${violations.length} violation(s). Denylist: ${DEFAULT_DENYLIST.join(", ")}`,
  );
  process.exit(1);
}

// Run only when invoked directly, not when imported by the test.
const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-dependency-licenses.mjs");
if (invokedDirectly) main();
