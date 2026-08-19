// How the smoke gets an app to drive.
//
// The packaged .app when there is one: that is what a user downloads, and
// packaging is the step most likely to leave something behind, and the built
// main entry otherwise, so the same smoke runs on a laptop after `pnpm build`
// without waiting on electron-builder.

import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Playwright transpiles this to CommonJS, where `import.meta` is unavailable,
// so the package root is resolved from the config's own cwd instead.
const ROOT = path.resolve(process.cwd());

/** The packaged binary electron-builder produced, if this run has one. */
export function packagedBinary(): string | null {
  const explicit = process.env.CIELE_DESKTOP_APP;
  if (explicit) return existsSync(explicit) ? explicit : null;

  if (process.platform === "win32") {
    // The NSIS installer cannot be driven headlessly; the unpacked build it
    // was made from is the same bundle, so that is what the smoke exercises.
    const dir = path.join(ROOT, "dist", "win-unpacked");
    if (!existsSync(dir)) return null;
    const exe = readdirSync(dir).find((entry) => entry.endsWith(".exe"));
    const binary = exe ? path.join(dir, exe) : null;
    return binary && existsSync(binary) ? binary : null;
  }

  const distMac = path.join(ROOT, "dist", "mac-arm64");
  const fallback = path.join(ROOT, "dist", "mac");
  const dir = existsSync(distMac) ? distMac : existsSync(fallback) ? fallback : null;
  if (!dir) return null;
  const bundle = readdirSync(dir).find((entry) => entry.endsWith(".app"));
  if (!bundle) return null;
  const binary = path.join(dir, bundle, "Contents", "MacOS", bundle.replace(/\.app$/, ""));
  return existsSync(binary) ? binary : null;
}

export interface LaunchOptions {
  /** Compose subcommands the fake docker fails once, e.g. ["pull"]. */
  failOnce?: string;
  /** Reuse a previous run's settings directory to test "remembers my choice". */
  userDataDir?: string;
  /**
   * Release tag the stack pins. Defaults to a stand-in, because the build
   * under test is never a stamped release and the fakes have no registry to
   * pull from, without one, every wizard test would stop at the "this build
   * is not a release" guard instead of exercising the flow.
   *
   * Pass `null` to leave it unset and drive that guard on purpose.
   */
  imageTag?: string | null;
}

export interface LaunchedApp {
  app: ElectronApplication;
  userDataDir: string;
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // A throwaway user-data directory per test, so one test's remembered mode
  // cannot decide another test's first screen.
  const userDataDir = options.userDataDir ?? mkdtempSync(path.join(tmpdir(), "ciele-desktop-"));
  const packaged = packagedBinary();
  const imageTag = options.imageTag === undefined ? "v0.0.0-smoke" : options.imageTag;

  const app = await electron.launch({
    executablePath: packaged ?? undefined,
    args: [
      ...(packaged ? [] : [path.join(ROOT, "out", "main", "index.js")]),
      "--fake-ports",
      `--user-data-dir=${userDataDir}`,
    ],
    env: {
      ...process.env,
      CIELE_DESKTOP_FAKE_PORTS: "1",
      ...(imageTag ? { CIELE_IMAGE_TAG: imageTag } : { CIELE_IMAGE_TAG: "" }),
      ...(options.failOnce ? { CIELE_DESKTOP_FAIL_ONCE: options.failOnce } : {}),
    },
  });
  return { app, userDataDir };
}
