// Where releases live, and how two of them compare.
//
// The public repository is the download address for the beta and the only
// thing the update check talks to. Kept in one file so the renderer's "get the
// update" link and the main process's check can never point at different
// places.

/** The open-source repository, in `owner/name` form. */
export const PUBLIC_REPO = "MattiaIppoliti/ciele";

export const RELEASES_API_URL = `https://api.github.com/repos/${PUBLIC_REPO}/releases/latest`;

export function latestReleaseUrl(): string {
  return `https://github.com/${PUBLIC_REPO}/releases/latest`;
}

/**
 * Compare two release versions, with or without the `v` prefix.
 *
 * Returns a negative number when `a` is older, 0 when they are the same
 * release, positive when `a` is newer. A pre-release suffix (`-beta.1`) sorts
 * before the release it leads to, as semver says; anything unparseable sorts
 * as equal, so a version this app cannot read never becomes a false "update
 * available" nag.
 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i]! - right.parts[i]!;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

function parse(version: string): { parts: number[]; pre: string } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? "",
  };
}
