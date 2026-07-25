// Standalone test for the release version bumper's pure logic.
// Matches the repo's script-test convention (plain node + assert, run
// directly). Run with:
//   node scripts/next-version.test.mjs

import assert from "node:assert/strict";
import {
  classifyCommit,
  nextVersion,
  parseVersion,
} from "./next-version.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

// --- parseVersion ---

check("parses a v-prefixed tag", () => {
  assert.deepEqual(parseVersion("v1.2.3"), { major: 1, minor: 2, patch: 3 });
});

check("parses a bare version and a pre-release suffix", () => {
  assert.deepEqual(parseVersion("0.4.0"), { major: 0, minor: 4, patch: 0 });
  assert.deepEqual(parseVersion("v2.0.0-rc.1"), {
    major: 2,
    minor: 0,
    patch: 0,
  });
});

check("rejects anything that is not a version", () => {
  for (const bad of ["latest", "v1.2", "release-1", ""]) {
    assert.throws(() => parseVersion(bad), /not a version tag/);
  }
});

// --- classifyCommit ---

check("feat subjects are features", () => {
  assert.equal(classifyCommit("feat: add flows"), "feat");
  assert.equal(classifyCommit("feat(web): add flows"), "feat");
});

check("a bang marks a breaking change", () => {
  assert.equal(classifyCommit("feat!: drop the old router"), "breaking");
  assert.equal(classifyCommit("refactor(db)!: rename the seam"), "breaking");
});

check("a BREAKING CHANGE footer outranks its own subject", () => {
  const message = [
    "feat: new provider connection shape",
    "",
    "BREAKING CHANGE: connection ids are no longer stable.",
  ].join("\n");
  assert.equal(classifyCommit(message), "breaking");
});

check("fix, docs, chore and merge commits are neither", () => {
  for (const m of [
    "fix: stop double-counting escalations",
    "docs: self-hosting upgrade page",
    "chore(deps): bump turbo",
    "Merge pull request #12 from a/b",
  ]) {
    assert.equal(classifyCommit(m), "other", m);
  }
});

check("a subject merely containing the word feature is not a feat", () => {
  assert.equal(classifyCommit("docs: describe the feat: prefix"), "other");
});

// --- nextVersion, post-1.0 ---

check("post-1.0 breaking bumps major", () => {
  assert.equal(nextVersion("v1.4.2", ["feat!: drop it"]), "v2.0.0");
});

check("post-1.0 feat bumps minor and resets patch", () => {
  assert.equal(nextVersion("v1.4.2", ["feat: add it"]), "v1.5.0");
});

check("post-1.0 anything else bumps patch", () => {
  assert.equal(nextVersion("v1.4.2", ["fix: repair it"]), "v1.4.3");
});

// --- nextVersion, pre-1.0 ---

check("pre-1.0 breaking bumps minor, not major", () => {
  assert.equal(nextVersion("v0.2.5", ["feat!: drop it"]), "v0.3.0");
});

check("pre-1.0 feat bumps minor", () => {
  assert.equal(nextVersion("v0.2.5", ["feat: add it"]), "v0.3.0");
});

check("pre-1.0 fix bumps patch", () => {
  assert.equal(nextVersion("v0.2.5", ["fix: repair it"]), "v0.2.6");
});

// --- nextVersion, mixed input ---

check("the highest bump in the batch wins", () => {
  const messages = [
    "fix: repair it",
    "feat: add it",
    "docs: write it down",
  ];
  assert.equal(nextVersion("v1.0.0", messages), "v1.1.0");
  assert.equal(
    nextVersion("v1.0.0", [...messages, "chore!: remove it"]),
    "v2.0.0",
  );
});

check("no commits still cuts a patch release", () => {
  assert.equal(nextVersion("v1.2.3", []), "v1.2.4");
});

console.log(`\n${passed} checks passed.`);
