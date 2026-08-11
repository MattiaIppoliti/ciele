// Wires the setup engine to the renderer.
//
// The engine is created once, lazily, with whichever ports this run is using.
// In `--fake-ports` the ports are the same scripted fakes the engine's tests
// use, which is how the packaged app is smoke-tested on a runner with no
// Docker Desktop.

import { app, ipcMain } from "electron";
import path from "node:path";
import { createSetupEngine, type SetupEngine } from "../setup/engine";
import { SETUP_STEPS } from "../setup/steps";
import { fakePorts } from "../setup/testing/fake-ports";
import { FAKE_ENV_TEMPLATE } from "../setup/testing/env-template";
import { broadcast } from "./broadcast";
import { createRealPorts } from "./ports";
import { LOCAL_BASE_URL } from "../shared/state";
import { imageTagFor, releaseVersion } from "../shared/release";
import { SETUP_CHANNELS } from "../shared/setup-ipc";
import type { SetupConfig, SetupPorts } from "../setup/ports";

const DOCKER_DOWNLOAD_URL = "https://www.docker.com/products/docker-desktop/";
const LOCAL_SUPABASE_URL = "http://localhost:8000";

export interface SetupHost {
  fakePorts: boolean;
  /** Called when every step has passed or been skipped. */
  onComplete(): void;
  /** Called when the user asks to run setup again from the beginning. */
  onReset(): void;
}

/**
 * Deploy assets — the compose definition and env template — ship inside the
 * app and are versioned with it, so the stack a given build sets up is the one
 * that build was tested against. In development they are read from the repo.
 */
export function deployDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "deploy")
    : path.join(app.getAppPath(), "..", "..", "deploy");
}

/**
 * This build's version — NOT `app.getVersion()` directly, which reports
 * Electron's own version when the app is unpackaged. See shared/release.ts.
 */
export function appVersion(): string {
  return releaseVersion(app.isPackaged, app.getVersion());
}

export function setupConfig(): SetupConfig {
  return {
    // Under the app's own data directory, so it survives app updates and is
    // removed with the app's data and nothing else.
    dataDir: path.join(app.getPath("userData"), "stack"),
    deployDir: deployDir(),
    // A stamped build pins the images matching its own version, so updating
    // the app is what rolls the local stack forward. An unstamped one asks for
    // CIELE_IMAGE_TAG rather than pinning a tag nobody published.
    imageTag: imageTagFor(appVersion(), process.env),
    appUrl: LOCAL_BASE_URL,
    supabaseUrl: LOCAL_SUPABASE_URL,
    dockerDownloadUrl: DOCKER_DOWNLOAD_URL,
  };
}

export function portsFor(host: SetupHost): SetupPorts {
  const config = setupConfig();
  if (!host.fakePorts) return createRealPorts(config);
  // `--fake-ports`: the same scripted fakes the engine's tests use, so the
  // flow the smoke drives is the flow the tests describe. The latency is
  // there to make each step land visibly rather than flash past.
  return fakePorts({
    files: { [`${config.deployDir}/.env.example`]: FAKE_ENV_TEMPLATE },
    latencyMs: 600,
    failOnce: process.env.CIELE_DESKTOP_FAIL_ONCE
      ? process.env.CIELE_DESKTOP_FAIL_ONCE.split(",")
      : [],
  });
}

let ports: SetupPorts | null = null;
let portsAreFake: boolean | null = null;

/** One set of ports per run, shared by the wizard and the stack controller. */
export function setupPorts(host: SetupHost): SetupPorts {
  // The memo would otherwise hand a caller asking for real ports the fakes a
  // previous caller created (or the reverse) without a word.
  if (ports && portsAreFake !== host.fakePorts) {
    throw new Error(
      `The ports were already created with fakePorts=${String(portsAreFake)} and cannot change mid-run.`,
    );
  }
  portsAreFake = host.fakePorts;
  ports ??= portsFor(host);
  return ports;
}

let engine: SetupEngine | null = null;

export function setupEngine(host: SetupHost): SetupEngine {
  if (engine) return engine;
  engine = createSetupEngine({
    steps: SETUP_STEPS,
    ports: setupPorts(host),
    config: setupConfig(),
  });
  engine.subscribe((snapshot) => {
    broadcast(SETUP_CHANNELS.snapshotChanged, snapshot);
    if (snapshot.complete) host.onComplete();
  });
  return engine;
}

export function registerSetupHandlers(host: SetupHost): void {
  ipcMain.handle(SETUP_CHANNELS.getSnapshot, () => setupEngine(host).snapshot());
  ipcMain.handle(SETUP_CHANNELS.run, () => setupEngine(host).run());
  ipcMain.handle(SETUP_CHANNELS.retry, () => setupEngine(host).retry());
  ipcMain.handle(SETUP_CHANNELS.skip, () => setupEngine(host).skip());
  ipcMain.handle(SETUP_CHANNELS.setInput, (_event, stepId: string, values: unknown) =>
    setupEngine(host).setInput(stepId, sanitiseInput(values)),
  );
  ipcMain.handle(SETUP_CHANNELS.revisit, (_event, stepId: string) =>
    setupEngine(host).revisit(String(stepId)),
  );
  ipcMain.handle(SETUP_CHANNELS.reset, () => {
    const snapshot = setupEngine(host).reset();
    // Clearing the engine alone would leave `setupComplete` set, so the next
    // launch would still skip the wizard the user just asked to see again.
    host.onReset();
    return snapshot;
  });
}

/** Only strings, only from the renderer's own fields — never a nested object. */
function sanitiseInput(values: unknown): Record<string, string> {
  if (typeof values !== "object" || values === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
