"use client";

import { useSyncExternalStore } from "react";

const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(HOVER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(HOVER_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * True when the primary pointer can hover (mouse / trackpad), false on
 * touch-first devices. SSR-safe (renders `false` on the server and the first
 * client paint, then resolves) and updates live if the capability changes,
 * e.g. a tablet docking a mouse.
 */
export function useHoverCapable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
