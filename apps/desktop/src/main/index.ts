// Ciele Desktop, main process.
//
// The app is a shell around the existing web app. It owns exactly three
// things: which of the two modes you are in, the session behind each of them,
// and (from the wizard onward) the local Docker stack. Everything a user
// actually does with Ciele happens in the product window, which is the web app
// unchanged.

import { BrowserWindow, app, ipcMain, session, shell } from "electron";
import { installAppMenu } from "./app-menu";
import { broadcast } from "./broadcast";
import { SettingsStore } from "./settings-store";
import { checkForUpdate } from "./update-check";
import { appVersion, registerSetupHandlers, setupConfig, setupPorts } from "./setup-handlers";
import { createStackController, registerStackHandlers } from "./stack";
import { showNative, showProduct, partitionForMode } from "./windows";
import {
  CHANNELS,
  normalizeBaseUrl,
  originForMode,
  type AppState,
  type Mode,
  type ProductError,
  type UpdateNotice,
} from "../shared/state";

/**
 * Fake ports mode: the wizard runs against scripted fakes instead of Docker.
 * The E2E smoke needs it (a CI runner has no Docker Desktop), and it is how a
 * contributor sees the whole flow on a machine that cannot run the stack.
 */
export const FAKE_PORTS =
  process.argv.includes("--fake-ports") || process.env.CIELE_DESKTOP_FAKE_PORTS === "1";

let settings: SettingsStore;
let update: UpdateNotice | null = null;
let productError: ProductError | null = null;

function state(): AppState {
  return {
    settings: settings.get(),
    version: appVersion(),
    update,
    productError,
    fakePorts: FAKE_PORTS,
  };
}

/** Push to whichever native window is open; the product window has no bridge. */
export function broadcastState(): void {
  broadcast(CHANNELS.stateChanged, state());
}

/**
 * Where to land on launch, and after any mode change.
 *
 * The rule the tickets ask for: pick a mode once, and every later launch goes
 * straight to the product, except local mode before the wizard has finished,
 * which goes to the wizard. First-run cost is paid once.
 */
function openForCurrentMode(): void {
  const current = settings.get();
  if (current.mode === null) return void showNative("/welcome");
  if (current.mode === "local" && !current.setupComplete) return void showNative("/setup");

  const url = originForMode(current.mode, current);
  // Every attempt starts clean, so a stale failure cannot outlive the retry
  // that fixed it.
  productError = null;
  showProduct(url, current.mode, {
    onUnreachable: (reason) => {
      // Come back to the app's own screens. Leaving the browser's error page
      // in a window with no address bar strands the user with nothing to press.
      productError = { url, reason };
      showNative("/unreachable");
      broadcastState();
    },
  });
}

/**
 * Sign-out clears the *partition*, not just the window: the whole point of a
 * persistent session is that a bare reload would sign you straight back in. A
 * shared machine must hold nothing after this.
 */
async function signOut(): Promise<AppState> {
  const mode = settings.get().mode;
  if (mode) {
    const partition = session.fromPartition(partitionForMode(mode));
    await partition.clearStorageData();
    await partition.clearCache();
    await partition.clearAuthCache();
  }
  settings.update({ mode: null });
  showNative("/welcome");
  return state();
}

function registerHandlers(): void {
  ipcMain.handle(CHANNELS.getState, () => state());

  ipcMain.handle(CHANNELS.chooseMode, (_event, mode: Mode) => {
    if (mode !== "saas" && mode !== "local") throw new Error(`Unknown mode: ${String(mode)}`);
    settings.update({ mode });
    // Through the one function that opens the product, so choosing a mode gets
    // the same unreachable handling as every other way in. Opening it directly
    // here is how the Sign in button came to strand users on a provider 404.
    openForCurrentMode();
    return state();
  });

  ipcMain.handle(CHANNELS.openProduct, () => {
    openForCurrentMode();
  });

  ipcMain.handle(CHANNELS.signOut, () => signOut());

  ipcMain.handle(CHANNELS.setSaasBaseUrl, (_event, raw: string) => {
    const normalized = normalizeBaseUrl(raw);
    if (!normalized) throw new Error("That is not an http or https address.");
    settings.update({ saasBaseUrl: normalized });
    return state();
  });

  ipcMain.handle(CHANNELS.dismissUpdate, () => {
    if (update) settings.update({ dismissedUpdate: update.version });
    update = null;
    return state();
  });

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: string) => {
    // Only ever a web address: this is a hole straight out to the OS handler,
    // and the renderer is not the only thing that could reach it.
    if (!/^https?:\/\//.test(url)) throw new Error("Only http(s) links can be opened.");
    await shell.openExternal(url);
  });

  const host = {
    fakePorts: FAKE_PORTS,
    onComplete: () => {
      // Remembered so later launches skip the wizard: first-run cost is paid
      // once. The user still has to press Open Ciele, finishing setup and
      // being yanked into the product are different things.
      if (!settings.get().setupComplete) {
        settings.update({ setupComplete: true });
        broadcastState();
      }
    },
    onReset: () => {
      settings.update({ mode: "local", setupComplete: false });
      broadcastState();
      showNative("/setup");
    },
  };
  registerSetupHandlers(host);
  // Same ports as the wizard: the stack the status screen reports on is the
  // one the wizard just stood up, fakes and all.
  registerStackHandlers(createStackController(setupPorts(host), setupConfig()));
}

app.whenReady().then(() => {
  settings = new SettingsStore(app.getPath("userData"));
  registerHandlers();
  installAppMenu({
    showWelcome: () => showNative("/welcome"),
    showSettings: () => showNative("/settings"),
    showStack: () => showNative("/stack"),
    openProduct: () => openForCurrentMode(),
    signOut: () => void signOut(),
  });
  openForCurrentMode();

  // Best-effort and last: an offline launch must be a normal launch.
  void checkForUpdate(appVersion(), settings.get().dismissedUpdate).then((found) => {
    update = found;
    if (found) broadcastState();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openForCurrentMode();
  });
});

// macOS convention is to keep the app alive with no windows, but this app has
// exactly one window and no dock-level surface behind it, so closing it means
// "I am done" everywhere. The local stack keeps running regardless; it is
// detached Docker, not a child process.
app.on("window-all-closed", () => app.quit());
