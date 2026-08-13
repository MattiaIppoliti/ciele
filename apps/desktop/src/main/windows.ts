// The two windows, and why there are two.
//
// Native screens (welcome, wizard, settings, stack status) are this app's own
// renderer and need the preload bridge. The product window loads a REMOTE
// origin, and remote content has no business holding a handle to the main
// process — so it gets no preload at all, and lives in its own persistent
// session partition whose cookies survive a restart and are what sign-out
// clears.
//
// `webPreferences` are fixed when a BrowserWindow is created, so those two
// postures cannot be one window that re-navigates. They are two windows,
// only one of which is open at a time; the bounds carry across so switching
// modes does not make the window jump.

import { BrowserWindow, shell } from "electron";
import path from "node:path";
import { CHANNELS, type Mode } from "../shared/state";

const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** Per-mode partition: a SaaS account and a local stack coexist, separately. */
export function partitionForMode(mode: Mode): string {
  return `persist:ciele-${mode}`;
}

export interface WindowHost {
  /** Bounds carried between the native and product windows. */
  bounds?: Electron.Rectangle;
}

const host: WindowHost = {};

let current: BrowserWindow | null = null;
let currentIsNative = false;

export function currentWindow(): BrowserWindow | null {
  return current && !current.isDestroyed() ? current : null;
}

function remember(window: BrowserWindow): void {
  const save = () => {
    if (!window.isDestroyed() && !window.isMinimized()) host.bounds = window.getBounds();
  };
  window.on("resize", save);
  window.on("move", save);
}

/**
 * Links a page opens (docs, the Docker Desktop download, a provider console)
 * belong in the user's browser, not in a chromeless Electron window with no
 * address bar. Applied to both windows.
 */
function openLinksExternally(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function replaceCurrent(next: BrowserWindow): BrowserWindow {
  const previous = current;
  current = next;
  next.once("ready-to-show", () => {
    next.show();
    // Closed only once the replacement is up, so the screen never flashes the
    // desktop between two windows of the same app.
    if (previous && !previous.isDestroyed()) previous.destroy();
  });
  return next;
}

/** The app's own renderer: welcome, wizard, settings, stack status. */
export function showNative(route: string): BrowserWindow {
  // Already on a native screen: this is a move between screens of the same
  // renderer, so it is a route change, not a new window. Rebuilding would
  // flash the desktop and throw away whatever the screen was showing.
  const existing = currentWindow();
  if (existing && currentIsNative) {
    existing.webContents.send(CHANNELS.navigate, route);
    existing.focus();
    return existing;
  }

  const window = new BrowserWindow({
    ...host.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // `hiddenInset` is a macOS style: the traffic lights float over the page
    // and the renderer's drag strip stands in for the title bar. On Windows it
    // would strip the frame — minimize/close included — so the native screens
    // keep the standard frame there.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    backgroundColor: "#0b0b0c",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  remember(window);
  openLinksExternally(window);

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void window.loadURL(`${devServer}#${route}`);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: route });
  }
  currentIsNative = true;
  return replaceCurrent(window);
}

/**
 * Turn Chromium's error codes into something a person can act on.
 *
 * The alternative is what the app did before: leave the browser's own error
 * page — or worse, a hosting provider's 404 — sitting in a window with no
 * address bar, no reload button and no way back except the menu bar.
 */
export function loadFailureReason(errorCode: number, description: string): string {
  switch (errorCode) {
    case -105: // ERR_NAME_NOT_RESOLVED
      return "That address does not exist. Check the server address for a typo.";
    case -102: // ERR_CONNECTION_REFUSED
      return "Nothing is listening at that address. If this is your own server, check it is running.";
    case -106: // ERR_INTERNET_DISCONNECTED
      return "This machine is offline.";
    case -7: // ERR_TIMED_OUT
      return "The server took too long to answer.";
    case -501: // ERR_INSECURE_RESPONSE
      return "The server's security certificate could not be trusted.";
    case -312: // ERR_UNSAFE_PORT
      return "Browsers refuse to connect on that port. Use a different one — 3000 and 8080 are safe choices.";
    default:
      return description ? `The server could not be reached (${description}).` : "The server could not be reached.";
  }
}

/** What a status code means when it is the *first* thing an origin says. */
export function httpFailureReason(status: number, origin: string): string | null {
  if (status < 400) return null;
  if (status === 404) {
    // The case that prompted this: a hostname parked at a provider with no
    // deployment behind it answers 404 for everything, including `/`.
    return `${origin} answered, but there is no Ciele there. Check the server address.`;
  }
  if (status === 401 || status === 403) return null; // a sign-in wall is not a failure
  if (status >= 500) return `${origin} is having trouble (HTTP ${status}). Try again shortly.`;
  return `${origin} answered HTTP ${status} instead of the app.`;
}

export interface ProductWindowOptions {
  /** Called when the origin never produced the app. */
  onUnreachable(reason: string): void;
}

/** The product itself: the existing web app, hosted or local. */
export function showProduct(
  origin: string,
  mode: Mode,
  options?: ProductWindowOptions,
): BrowserWindow {
  const window = new BrowserWindow({
    ...host.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // A real title bar, unlike the native screens.
    //
    // `hiddenInset` draws the page under the traffic lights and leaves it to
    // the page to keep its top-left corner clear. Our own screens do that —
    // `TitleBar` reserves the strip and right-aligns into it. The product is a
    // page this app did not write and must not have to know it is being
    // hosted: its top bar puts the navigation toggle at the far left (a 36px
    // control from x=16), which lands exactly under the buttons (x≈14–66).
    // The result is three OS dots sitting on top of a control you cannot
    // click.
    //
    // So the OS gets its own strip here and the page keeps all of its own.
    titleBarStyle: "default",
    backgroundColor: "#ffffff",
    webPreferences: {
      // No preload, on purpose: nothing this app can do is reachable from a
      // page it did not write.
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      partition: partitionForMode(mode),
    },
  });
  remember(window);
  openLinksExternally(window);

  // Keep the window on the product. A sign-in flow may bounce through an
  // identity provider, so navigation itself is allowed — but anything that is
  // not a web page (a custom scheme handed over by a page, say) is not.
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Only the FIRST load is judged. Once the app is up it owns its own routing,
  // and a 404 on some page inside it is the product's business, not a reason to
  // yank the user out of it.
  let landed = false;
  const fail = (reason: string) => {
    if (landed) return;
    landed = true;
    options?.onUnreachable(reason);
  };

  window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which is what a redirect or a cancelled load looks
    // like — routine, not a failure.
    if (!isMainFrame || errorCode === -3) return;
    // The address is rendered on its own line by the screen, so the reason
    // stays a sentence rather than repeating it.
    void url;
    fail(loadFailureReason(errorCode, description));
  });

  window.webContents.on("did-navigate", (_event, _url, httpResponseCode) => {
    const reason = httpFailureReason(httpResponseCode, origin);
    if (reason) fail(reason);
    else landed = true;
  });

  void window.loadURL(origin);
  currentIsNative = false;
  return replaceCurrent(window);
}
