// Next release version from the commits since the last tag.
//
// Every merge to main cuts a release (auto-release.yml), so the version has
// to be derived, never chosen by hand. The rule is Conventional Commits with
// one pre-1.0 adjustment:
//
//   post-1.0   breaking -> major   feat -> minor   anything else -> patch
//   pre-1.0    breaking -> minor   feat -> minor   anything else -> patch
//
// The pre-1.0 case is deliberate: while the major is 0 the API is not
// promised, and bumping 0.x straight to 1.0.0 on the first breaking change
// would announce a stability commitment nobody made.
//
// Pure logic (parseVersion / classifyCommit / nextVersion) is separated from
// the git I/O so it can be unit-tested without a repository.

import { execFileSync } from "node:child_process";

/** `v1.2.3` / `1.2.3` -> {major,minor,patch}. Throws on anything else. */
export function parseVersion(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(tag).trim());
  if (!m) throw new Error(`not a version tag: ${tag}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * One commit message -> "breaking" | "feat" | "other".
 *
 * Reads the whole message, not just the subject: `BREAKING CHANGE:` is a
 * footer convention, so a `feat:` subject with that footer is breaking.
 */
export function classifyCommit(message) {
  const text = String(message);
  const subject = text.split("\n", 1)[0] ?? "";

  // `feat!:` / `fix(scope)!:`, the `!` marks a breaking change.
  if (/^[a-z]+(\([^)]*\))?!:/i.test(subject)) return "breaking";
  if (/^BREAKING[ -]CHANGE:/m.test(text)) return "breaking";
  if (/^feat(\([^)]*\))?:/i.test(subject)) return "feat";
  return "other";
}

/**
 * Highest bump the commits ask for, applied to `currentTag`.
 *
 * An empty list still bumps a patch: a merge landed, so a release is cut.
 * Callers that want "no commits, no release" check that before calling.
 */
export function nextVersion(currentTag, messages) {
  const { major, minor, patch } = parseVersion(currentTag);
  const kinds = new Set(messages.map(classifyCommit));

  const preOne = major === 0;
  if (kinds.has("breaking")) {
    return preOne
      ? `v${major}.${minor + 1}.0`
      : `v${major + 1}.0.0`;
  }
  if (kinds.has("feat")) return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

// --- git I/O -------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Latest `vX.Y.Z` tag reachable from HEAD, or null if there is none. */
export function latestTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v*.*.*"]);
  } catch {
    return null;
  }
}

/** Commit messages after `tag` up to HEAD (whole message, NUL-separated). */
export function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const out = git(["log", range, "--format=%B%x00"]);
  return out
    .split("\0")
    .map((s) => s.trim())
    .filter(Boolean);
}

const isMain =
  process.argv[1] && process.argv[1].endsWith("next-version.mjs");

if (isMain) {
  const tag = latestTag();
  const messages = commitsSince(tag);

  if (!tag) {
    // No release yet: the first one is v0.1.0 whatever the history says.
    console.log("v0.1.0");
  } else if (messages.length === 0) {
    console.error("no commits since " + tag);
    process.exit(1);
  } else {
    console.log(nextVersion(tag, messages));
  }
}
