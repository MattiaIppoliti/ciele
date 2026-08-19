// Which release this build claims to be, and what to do when it claims none.
//
// The app's version is load-bearing twice over: it is compared against the
// latest release to decide whether to offer an update, and it is the image tag
// the local stack is pinned to. Only the release workflow stamps a real one
// (`desktop-release.yml`), so every other build, a contributor's, a CI
// artifact, `pnpm dev`, carries the placeholder below.
//
// Left unhandled that placeholder is two bugs at once: the update banner nags
// forever, and setup dies at the image pull against a tag that was never
// published. So the placeholder is named, and both callers ask about it.

/**
 * The version in `package.json`. Deliberately not a plausible release number:
 * `0.1.0` would look like one and fail silently in exactly the two ways above.
 */
export const DEV_VERSION = "0.0.0-dev";

export function isDevBuild(version: string): boolean {
  return version === DEV_VERSION;
}

/**
 * The version this build should call itself, given what Electron reports.
 *
 * `app.getVersion()` is only the app's version once the app is packaged.
 * Launched as a raw script: `electron out/main/index.js`, which is `pnpm dev`,
 * `pnpm start` and a local E2E run, it returns **Electron's own version**
 * (43.3.0), because there is no app bundle whose manifest it could read.
 *
 * That is worse than useless here: 43.3.0 is not the placeholder, so the build
 * looks stamped. It would nag about updates against a repository whose releases
 * are nowhere near 43, and pin the local stack to `v43.3.0`, an image tag
 * nobody will ever publish. It cost a CI run to find, because the packaged app
 * CI drives is the one case where `getVersion()` is right and every local run
 * is the case where it is wrong.
 *
 * Unpackaged is a development build by definition, so it is named as one.
 */
export function releaseVersion(isPackaged: boolean, reported: string): string {
  return isPackaged ? reported : DEV_VERSION;
}

/**
 * The image tag the local stack pins, or null when this build cannot know it.
 *
 * A stamped build pins its own version, so updating the app is what rolls the
 * stack forward. An unstamped one has no published images to point at, and
 * guessing (`latest`, the newest tag we happen to find) would silently run a
 * different Ciele than the one that was built, so it asks for
 * `CIELE_IMAGE_TAG` instead, and the wizard says so rather than failing at the
 * pull with a registry error nobody can act on.
 */
export function imageTagFor(
  version: string,
  env: { CIELE_IMAGE_TAG?: string } = {},
): string | null {
  const override = env.CIELE_IMAGE_TAG?.trim();
  if (override) return override;
  return isDevBuild(version) ? null : `v${version}`;
}
