// The two facts about the host platform the setup surface needs, as pure
// functions of a platform string — so they are testable for a platform the
// test is not running on, and so `src/setup/` itself never reads
// `process.platform` (the engine stays platform-blind; main injects these
// through the config).

/**
 * What separates entries in a COMPOSE_FILE list. Compose splits on the
 * platform's path-list separator: `;` on Windows — where a colon is a drive
 * letter — and `:` everywhere else (matching what `bootstrap.sh` writes).
 */
export function composePathSeparator(platform: string): string {
  return platform === "win32" ? ";" : ":";
}

/**
 * The Docker Desktop page for the one prerequisite the user installs
 * themselves — their platform's install page, not a generic landing page the
 * user then has to navigate mid-wizard.
 */
export function dockerDownloadUrl(platform: string): string {
  if (platform === "win32") return "https://docs.docker.com/desktop/setup/install/windows-install/";
  if (platform === "darwin") return "https://docs.docker.com/desktop/setup/install/mac-install/";
  return "https://www.docker.com/products/docker-desktop/";
}
