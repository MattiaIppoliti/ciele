import { normalizeSafeOrigin } from "./safe-origin";

/**
 * The one-command self-host installer: the script served at `/install.sh` and
 * the line the download page tells you to paste.
 *
 * This exists because `deploy/bootstrap.sh` cannot be piped from curl, it
 * `cd`s to its own directory and reads `.env.example` and `docker-compose.yml`
 * from beside itself, so it needs the checkout to already be on disk. This
 * script is the missing half: detect the platform, prove the prerequisites,
 * fetch the source, then hand off. It deliberately does no configuration of
 * its own, every secret and every compose decision stays in `bootstrap.sh`,
 * which remains the single source of truth for what a stack is.
 *
 * The facts it borrows from `bootstrap.sh`, where the script lives, what
 * interprets it, what it needs on PATH, which flags it parses, are exported
 * as constants below and pinned to the real file by `self-host-install.test.ts`.
 * That test is the reason this can be trusted: rename a flag or move the
 * script and the build fails here rather than in someone's terminal.
 */

/** Where the installer is served. A route segment, so it is `/install.sh`. */
export const INSTALL_SCRIPT_PATH = "/install.sh";

/** The handoff target, relative to the root of a checkout. */
export const BOOTSTRAP_RELATIVE_PATH = "deploy/bootstrap.sh";

/**
 * `bootstrap.sh` is a bash script, and the installer runs it by explicit
 * interpreter rather than by execute bit, a release tarball is not guaranteed
 * to preserve the mode, and `sh bootstrap.sh` would run its bash-isms under
 * the wrong shell.
 */
export const BOOTSTRAP_INTERPRETER = "bash";

/**
 * What must be on PATH before the handoff is worth attempting: bash to run
 * `bootstrap.sh`, openssl because it generates every secret, docker because it
 * is the stack. Checked up front so a missing dependency is one clear line
 * instead of a failure five minutes into a build.
 */
export const BOOTSTRAP_REQUIRED_COMMANDS = ["bash", "openssl", "docker"] as const;

/**
 * The flags the installer forwards, and therefore advertises. `bootstrap.sh`
 * accepts more than the download page shows; these are the ones documented as
 * reachable through the pipe (`| sh -s -- --seed`).
 */
export const BOOTSTRAP_FORWARDED_FLAGS = ["--seed", "--env-only", "--images"] as const;

/**
 * The macOS app bundle Ciele Desktop packages as, electron-builder's
 * `productName` plus `.app`. A Mac without Docker is handed to this app
 * instead of an error: its guided setup links Docker Desktop, re-checks in
 * place, and stands up the same compose stack `bootstrap.sh` would. Pinned to
 * `apps/desktop/electron-builder.yml` by `self-host-install.test.ts`.
 */
export const DESKTOP_APP_BUNDLE = "Ciele.app";

/**
 * What every macOS Desktop release asset ends with (electron-builder's mac
 * `zip` target naming: `Ciele-<version>-mac.zip`, arm64 builds with an
 * `-arm64` in between). The installer picks the right one from the latest
 * GitHub release by this suffix plus the machine's architecture.
 */
export const DESKTOP_MAC_ASSET_SUFFIX = "-mac.zip";

/** Default checkout directory, relative to wherever the command was run. */
export const DEFAULT_CHECKOUT_DIR = "ciele";

/**
 * The open-source repository the installer clones and the download page links
 * to. Overridable so a fork installs itself rather than us; resolved here so
 * the page's clone line and the served script can never name different repos.
 */
export function resolveSourceUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/MattiaIppoliti/ciele"
  );
}

/**
 * A repository URL is about to be interpolated into a double-quoted shell
 * string, so "parses as a URL" is not enough, `$`, a backtick or a quote
 * would escape the literal. https and an unreserved-character path only.
 */
export function normalizeSourceUrl(rawSourceUrl: string): string {
  const url = new URL(rawSourceUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Unsupported Ciele source URL.");
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~-]+)*$/.test(normalized)) {
    throw new Error("Unsupported Ciele source URL.");
  }
  return normalized;
}

/**
 * The single line a visitor copies. Kept next to the script it fetches so the
 * path can never drift between the page and the route.
 */
export function selfHostInstallCommand(rawOrigin: string): string {
  return `curl -fsSL ${normalizeSafeOrigin(rawOrigin)}${INSTALL_SCRIPT_PATH} | sh`;
}

/**
 * The line this deployment can actually hand out, or `null` when it cannot
 * build one. The origin comes from the app's own configuration rather than a
 * literal, so a fork or a preview deployment copies a command that resolves;
 * a build with a nonsense origin shows no command at all rather than one that
 * 404s in someone's terminal.
 *
 * Shared by the home hero and the download page, which must never disagree
 * about the command they hand out.
 */
export function resolveSelfHostInstallCommand(): string | null {
  try {
    return selfHostInstallCommand(
      process.env.NEXT_PUBLIC_APP_URL || "https://ciele.app"
    );
  } catch {
    return null;
  }
}

/**
 * Where the packaged Ciele Desktop build is published: the latest release of
 * the source repository, with the macOS `.zip` attached (the asset the
 * installer script picks by `DESKTOP_MAC_ASSET_SUFFIX`). Resolved through the
 * same repo helper as the clone line, so a fork hands out its own package.
 */
export function resolveDesktopPackageUrl(): string {
  return `${resolveSourceUrl()}/releases/latest`;
}

/**
 * The script served at `/install.sh`.
 *
 * POSIX sh, because it is piped to `sh`. Nothing here reads stdin, stdin *is*
 * the script when curl-piped, so a prompt would either consume the rest of the
 * script or hang; every choice is an environment variable or a forwarded flag
 * instead. Nothing here deletes anything either: an unexpected directory is a
 * refusal, never a cleanup.
 */
export function buildSelfHostInstallScript(rawSourceUrl: string): string {
  const repo = normalizeSourceUrl(rawSourceUrl);
  // Docker gets its own platform-aware check below; everything else is a
  // plain "on PATH or refuse".
  const preflight = BOOTSTRAP_REQUIRED_COMMANDS.filter((c) => c !== "docker").join(" ");

  return `#!/bin/sh
# Install a self-hosted Ciele.
#
#   curl -fsSL <origin>${INSTALL_SCRIPT_PATH} | sh
#   curl -fsSL <origin>${INSTALL_SCRIPT_PATH} | sh -s -- --seed
#
# Fetches the source, then hands off to ${BOOTSTRAP_RELATIVE_PATH}, which
# generates every secret and starts the stack. Arguments after \`-s --\` are
# forwarded to it (${BOOTSTRAP_FORWARDED_FLAGS.join(", ")}).
#
# A Mac without Docker is not an error: the script fetches Ciele Desktop
# (or opens it if already installed) and the app guides the rest, Docker
# install included.
#
# Environment:
#   CIELE_DIR   where to put the checkout (default: ./${DEFAULT_CHECKOUT_DIR})
#   CIELE_REF   a release tag to install instead of the default branch
#
# Generated by apps/web/src/lib/self-host-install.ts, do not edit by hand.
set -eu

REPO="${repo}"
DIR="\${CIELE_DIR:-${DEFAULT_CHECKOUT_DIR}}"
REF="\${CIELE_REF:-}"

say() { printf '%s\\n' "$*"; }
die() { printf 'Error: %s\\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s 2>/dev/null || echo unknown)"
case "$OS" in
  Darwin | Linux) ;;
  MINGW* | MSYS* | CYGWIN*)
    die "Windows shells cannot run this installer. Use Ciele Desktop, or run it inside WSL2."
    ;;
  *) die "Unsupported operating system, self-hosting is supported on macOS and Linux." ;;
esac

for cmd in ${preflight}; do
  have "$cmd" || die "'$cmd' is required but not installed."
done

# Docker is the stack itself, so on Linux its absence is a refusal. A Mac
# gets handed to Ciele Desktop instead: the app's guided setup links Docker
# Desktop, re-checks in place, and stands up the same compose stack
# bootstrap.sh would, no terminal needed from there on.
if ! have docker; then
  [ "$OS" = "Darwin" ] ||
    die "'docker' is required but not installed."

  say "Docker is not installed. Handing you to Ciele Desktop instead, the"
  say "app walks you through installing Docker and sets up the stack itself."

  for app in "/Applications/${DESKTOP_APP_BUNDLE}" "$HOME/Applications/${DESKTOP_APP_BUNDLE}"; do
    if [ -d "$app" ]; then
      say "Ciele Desktop is already installed, opening it."
      open "$app" 2>/dev/null || say "Open $app from Finder to continue."
      exit 0
    fi
  done

  # The download needs the GitHub releases API; a fork hosted elsewhere gets
  # the plain refusal with both ways forward spelled out.
  case "$REPO" in
    https://github.com/*) ;;
    *) die "'docker' is required but not installed. Install Docker Desktop and re-run, or set up without a terminal using Ciele Desktop: $REPO/releases" ;;
  esac

  assets="$(curl -fsSL "https://api.github.com/repos/\${REPO#https://github.com/}/releases/latest" |
    grep -o '"browser_download_url": *"[^"]*${DESKTOP_MAC_ASSET_SUFFIX}"' | cut -d'"' -f4 || true)"
  case "$(uname -m)" in
    arm64) app_zip="$(printf '%s\n' "$assets" | grep arm64 | head -n 1 || true)" ;;
    *) app_zip="$(printf '%s\n' "$assets" | grep -v arm64 | head -n 1 || true)" ;;
  esac
  [ -n "$app_zip" ] ||
    die "No Ciele Desktop download found. Install Docker Desktop and re-run, or get the app from $REPO/releases/latest"

  say "Downloading $app_zip…"
  tmp="$(mktemp -d)"
  curl -fSL --progress-bar "$app_zip" -o "$tmp/${DESKTOP_APP_BUNDLE}.zip"
  mkdir -p "$HOME/Applications"
  # ditto is macOS's own unarchiver; it keeps the .app bundle intact.
  ditto -x -k "$tmp/${DESKTOP_APP_BUNDLE}.zip" "$HOME/Applications"

  say ""
  say "Ciele Desktop is in $HOME/Applications, opening it now. It takes over"
  say "from here: install Docker when it asks, and it starts the stack itself."
  say "If macOS blocks the first open, right-click ${DESKTOP_APP_BUNDLE} and choose Open."
  open "$HOME/Applications/${DESKTOP_APP_BUNDLE}" 2>/dev/null ||
    say "Open it from Finder to continue."
  exit 0
fi

# Compose ships as a docker plugin or as a standalone binary; bootstrap.sh
# accepts either, so accept either here too rather than rejecting a working
# machine.
if ! docker compose version >/dev/null 2>&1 && ! have docker-compose; then
  die "Docker Compose is required (install Docker Desktop or the compose plugin)."
fi

if [ -e "$DIR" ]; then
  # Re-running bootstrap.sh over an existing checkout is safe by design, it
  # never overwrites an existing deploy/.env, so a Ciele checkout is a resume,
  # and anything else is left strictly alone.
  [ -f "$DIR/${BOOTSTRAP_RELATIVE_PATH}" ] ||
    die "'$DIR' already exists and is not a Ciele checkout. Move it, or set CIELE_DIR to another path."
  say "Reusing the existing checkout in $DIR."
else
  say "Fetching Ciele into $DIR…"
  if have git; then
    if [ -n "$REF" ]; then
      git clone --depth 1 --branch "$REF" "$REPO.git" "$DIR"
    else
      git clone --depth 1 "$REPO.git" "$DIR"
    fi
  elif have curl && have tar; then
    # No git: a release tarball carries the same tree. --strip-components drops
    # the archive's own top-level directory, whose name embeds the ref.
    if [ -n "$REF" ]; then
      archive="$REPO/archive/refs/tags/$REF.tar.gz"
    else
      archive="$REPO/archive/refs/heads/main.tar.gz"
    fi
    mkdir -p "$DIR"
    curl -fsSL "$archive" | tar -xz -C "$DIR" --strip-components=1
  else
    die "Fetching the source needs either 'git', or 'curl' and 'tar'."
  fi
fi

cd "$DIR"
[ -f "${BOOTSTRAP_RELATIVE_PATH}" ] || die "This checkout has no ${BOOTSTRAP_RELATIVE_PATH}."

say ""
say "Handing off to ${BOOTSTRAP_RELATIVE_PATH}, it generates every secret and starts the stack."
say ""
exec ${BOOTSTRAP_INTERPRETER} ./${BOOTSTRAP_RELATIVE_PATH} "$@"
`;
}
