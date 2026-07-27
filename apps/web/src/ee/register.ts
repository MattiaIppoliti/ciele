/**
 * Enterprise registration entrypoint — the OSS stub (#435 seam).
 *
 * This open-source version registers nothing, so the build runs entirely on the
 * no-op capability defaults (metering allows all; billing reports no
 * subscription — see @agent-hub/agent's ee.ts). Its mere presence IS the seam: the
 * enterprise edition ships its own version of this file — excluded from the
 * public mirror — that calls `registerEnterpriseCapabilities` (imported from
 * `@agent-hub/agent`) with real metering enforcement and billing.
 *
 * Loaded once at startup by `instrumentation.ts`. Keep the OSS version inert
 * and dependency-free: stripping enterprise code is a file overwrite in the
 * mirror, never a build-time alias or config flag.
 */

// OSS: intentionally no registration. The enterprise edition overwrites this
// file with its capability wiring.
export {};
