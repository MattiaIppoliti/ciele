// Supply-chain contract for the GitHub Actions workflows (#801, CYB-08).
//
// A third-party action referenced by a mutable tag is a repository we do not
// own deciding what runs with our secrets, on every workflow run, forever. The
// tag can be moved; a commit SHA cannot. So every `uses:` that names an
// external repository must name a 40-character SHA, with the human-readable
// version alongside it as a comment so an upgrade is still reviewable.
//
// Local actions (`./.github/...`) and reusable workflows in this repository are
// exempt: they are already the code under review.
//
// Plain node + assert, matching the repo's script-test convention:
//   node scripts/workflow-pins.test.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.join(here, "..", ".github", "workflows");

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok, ${label}`);
}

const files = readdirSync(workflowDir).filter((name) => name.endsWith(".yml"));

/** Every `uses:` line, with the file and line it came from. */
function usesLines() {
  const found = [];
  for (const file of files) {
    const text = readFileSync(path.join(workflowDir, file), "utf8");
    text.split("\n").forEach((line, index) => {
      const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
      if (match) found.push({ file, line: index + 1, ref: match[1], raw: line });
    });
  }
  return found;
}

check("there are workflows to check", () => {
  assert.ok(files.length > 0, "no workflow files found");
  assert.ok(usesLines().length > 0, "no `uses:` lines found");
});

check("every third-party action is pinned to a commit SHA", () => {
  for (const { file, line, ref, raw } of usesLines()) {
    // A path reference is this repository's own code.
    if (ref.startsWith("./")) continue;
    const [repo, version] = ref.split("@");
    assert.ok(
      version,
      `${file}:${line} uses ${repo} with no version at all`
    );
    assert.match(
      version,
      /^[0-9a-f]{40}$/,
      `${file}:${line} pins ${repo} to the mutable ref '${version}'. Pin the commit SHA, e.g. ` +
        `uses: ${repo}@<40-char-sha> # ${version}`
    );
    assert.match(
      raw,
      /#\s*v?\d/,
      `${file}:${line} pins ${repo} by SHA but names no version. Add the tag as a trailing ` +
        `comment so the next upgrade is reviewable.`
    );
  }
});

check("the same action is pinned to one SHA everywhere", () => {
  const byRepo = new Map();
  for (const { file, line, ref } of usesLines()) {
    if (ref.startsWith("./")) continue;
    const [repo, sha] = ref.split("@");
    const seen = byRepo.get(repo);
    if (seen) {
      assert.equal(
        sha,
        seen.sha,
        `${repo} is pinned to two different commits: ${seen.file}:${seen.line} and ${file}:${line}`
      );
    } else {
      byRepo.set(repo, { sha, file, line });
    }
  }
});

console.log(`\n${passed} checks passed.`);
