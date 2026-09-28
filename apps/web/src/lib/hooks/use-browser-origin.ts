"use client";

import { useSyncExternalStore } from "react";

/** No-op store subscription: window.location.origin never changes at runtime. */
const NOOP_SUBSCRIBE = () => () => {};

/**
 * This deployment's origin, for snippets and URIs a Member copies elsewhere.
 * The server and the first client paint render a placeholder, then the real
 * origin: that avoids both a hydration mismatch and a setState in an effect.
 */
export function useBrowserOrigin(): string {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => window.location.origin,
    () => "https://your-app.example"
  );
}
