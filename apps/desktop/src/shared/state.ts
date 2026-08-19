// Everything the three processes agree on: the app's persisted settings, the
// state the renderer draws, and the one bridge the preload exposes.
//
// Deliberately free of `electron` and of node builtins, the renderer imports
// this file too, and a stray import there is a bundle error at best and a
// leaked main-process API at worst.

/** Which of the two paths the user is on. `null` until they pick. */
export type Mode = "saas" | "local";

/**
 * The hosted product. A user pointing the app at a self-hosted server changes
 * this; it is a default, never a lock-in.
 *
 * This is the origin that actually serves the app today. The repository's
 * architecture docs name `platform.ciele.app`, and the first cut of this file
 * took them at their word, but that host is not provisioned, so Sign in
 * landed on a registrar 404 inside a window with no address bar. A default
 * that does not resolve is worse than no default. If `platform.` is stood up
 * later, this constant is the one line that moves.
 */
export const DEFAULT_SAAS_BASE_URL = "https://ciele.app";

/** Where the guided local stack serves the product. */
export const LOCAL_BASE_URL = "http://localhost:3000";

export interface Settings {
  mode: Mode | null;
  /** Origin the sign-in path loads. Also serves remote self-hosted servers. */
  saasBaseUrl: string;
  /** True once the local-stack wizard has finished, so later launches skip it. */
  setupComplete: boolean;
  /** Release the user has already been told about; suppresses a repeat notice. */
  dismissedUpdate: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: null,
  saasBaseUrl: DEFAULT_SAAS_BASE_URL,
  setupComplete: false,
  dismissedUpdate: null,
};

/**
 * Read settings back from whatever is on disk.
 *
 * Deliberately total: a settings file that a hand-edit, a partial write or a
 * version skew left malformed must not stop the app from opening. Every
 * unusable field falls back to its default, which is always a working app.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  const mode = record.mode;
  return {
    mode: mode === "saas" || mode === "local" ? mode : null,
    saasBaseUrl: normalizeBaseUrl(record.saasBaseUrl) ?? DEFAULT_SAAS_BASE_URL,
    setupComplete: record.setupComplete === true,
    dismissedUpdate:
      typeof record.dismissedUpdate === "string" ? record.dismissedUpdate : null,
  };
}

/**
 * Accept what a person would actually type for a server address, or reject it.
 *
 * Returns the origin alone: a path, query or fragment on a base URL is a
 * mistake we would otherwise carry into every navigation. Only http and https
 * are allowed: `file:` would hand the product window the local filesystem.
 */
export function normalizeBaseUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // A bare host is what people type; assume the safer scheme.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.origin;
}

/** Which origin a mode loads. */
export function originForMode(mode: Mode, settings: Settings): string {
  return mode === "saas" ? settings.saasBaseUrl : LOCAL_BASE_URL;
}

/** An available release the user has not already dismissed. */
export interface UpdateNotice {
  version: string;
  url: string;
}

/**
 * The product origin did not load, so the app came back to its own screens
 * rather than leaving a browser error in a window with no address bar.
 */
export interface ProductError {
  /** The address that was tried, shown so the user can see what to correct. */
  url: string;
  /** Why, in words a person can act on. */
  reason: string;
}

/** What the native renderer draws. Pushed on every change. */
export interface AppState {
  settings: Settings;
  /** This build's version, shown in settings and compared against releases. */
  version: string;
  update: UpdateNotice | null;
  /** Set when the product window could not load; null the rest of the time. */
  productError: ProductError | null;
  /** True when the ports are fakes, the E2E smoke and `--fake-ports` runs. */
  fakePorts: boolean;
}

/**
 * The preload bridge, in full. The product window never gets this: it loads a
 * remote origin, and remote content has no business holding a handle to the
 * main process. Native screens are the app's own renderer, and only they are
 * given the preload.
 */
export interface CieleBridge {
  getState(): Promise<AppState>;
  /** Push-based, so a menu action and a click update the same screen. */
  onState(listener: (state: AppState) => void): () => void;
  /** The main process moving the native window between its own screens. */
  onNavigate(listener: (route: string) => void): () => void;
  chooseMode(mode: Mode): Promise<AppState>;
  /** Leave the native screens and load the current mode's product origin. */
  openProduct(): Promise<void>;
  /** Clear the mode's stored session and come back to the welcome screen. */
  signOut(): Promise<AppState>;
  setSaasBaseUrl(url: string): Promise<AppState>;
  dismissUpdate(): Promise<AppState>;
  openExternal(url: string): Promise<void>;
}

/** IPC channel names, in one place so main and preload cannot drift. */
export const CHANNELS = {
  getState: "ciele:get-state",
  stateChanged: "ciele:state-changed",
  navigate: "ciele:navigate",
  chooseMode: "ciele:choose-mode",
  openProduct: "ciele:open-product",
  signOut: "ciele:sign-out",
  setSaasBaseUrl: "ciele:set-saas-base-url",
  dismissUpdate: "ciele:dismiss-update",
  openExternal: "ciele:open-external",
} as const;
