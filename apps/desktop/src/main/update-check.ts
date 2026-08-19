// "There is a newer version", nothing more (#690).
//
// The beta is unsigned, and macOS will not auto-update an unsigned app, so
// there is no updater to run. What the app can honestly do is notice that a
// newer release exists and link the download.
//
// Failure is silence, always. A user on a plane, behind a proxy, or on a
// machine that cannot reach GitHub gets a working app and no dialog.

import { compareVersions, latestReleaseUrl, RELEASES_API_URL } from "../shared/version";
import { isDevBuild } from "../shared/release";
import type { UpdateNotice } from "../shared/state";

const TIMEOUT_MS = 5_000;

interface ReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export async function checkForUpdate(
  currentVersion: string,
  dismissed: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateNotice | null> {
  // A build the release workflow never stamped is older than every release by
  // definition, so without this it shows the banner permanently, and the
  // download it offers is not the build the developer is running.
  if (isDevBuild(currentVersion)) return null;

  let payload: ReleasePayload;
  try {
    const response = await fetchImpl(RELEASES_API_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    payload = (await response.json()) as ReleasePayload;
  } catch {
    return null;
  }
  return noticeFor(payload, currentVersion, dismissed);
}

/**
 * Split out from the fetch so the decision, which is the part with rules in
 * it, is testable without a network.
 */
export function noticeFor(
  payload: ReleasePayload,
  currentVersion: string,
  dismissed: string | null,
): UpdateNotice | null {
  if (payload.draft === true || payload.prerelease === true) return null;
  const tag = typeof payload.tag_name === "string" ? payload.tag_name : null;
  if (!tag) return null;
  if (compareVersions(tag, currentVersion) <= 0) return null;
  if (dismissed && compareVersions(tag, dismissed) <= 0) return null;
  const url = typeof payload.html_url === "string" ? payload.html_url : latestReleaseUrl();
  return { version: tag, url };
}
