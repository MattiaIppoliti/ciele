// The renderer's view of the preload bridge.
//
// `window.ciele` is injected by the preload and is always there in the app.
// It is *not* there under `vite dev` in a plain browser tab, which is the only
// reason this is a lookup rather than a bare global.

import { useEffect, useState } from "react";
import type { AppState, CieleBridge } from "../../shared/state";
import type { SetupBridge } from "../../shared/setup-ipc";
import type { StackBridge } from "../../shared/stack";

/** The whole preload surface, in one declaration so the two halves agree. */
type Bridge = CieleBridge & SetupBridge & StackBridge;

declare global {
  interface Window {
    ciele?: Bridge;
  }
}

export function bridge(): Bridge {
  const found = window.ciele;
  if (!found) throw new Error("The native bridge is missing, is this running outside Electron?");
  return found;
}

/** The whole app state, kept current by the main process's pushes. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let cancelled = false;
    void bridge()
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      });
    const unsubscribe = bridge().onState(setState);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return state;
}

/**
 * Which screen to draw, from the URL hash the main process navigates with.
 *
 * A router library for four screens with no history to speak of would be more
 * moving parts than the thing it routes.
 */
export function useRoute(): string {
  const read = () => window.location.hash.replace(/^#/, "") || "/welcome";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    // The main process also moves between screens, a menu item, or choosing a
    // mode. It does so without rebuilding the window, so this is a hash change
    // rather than a reload.
    const unsubscribe = bridge().onNavigate(navigate);
    return () => {
      window.removeEventListener("hashchange", onChange);
      unsubscribe();
    };
  }, []);
  return route;
}

export function navigate(route: string): void {
  window.location.hash = route;
}
