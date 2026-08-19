// Vendored from thinking-orbs (github.com/Jakubantalik/thinking-orbs, MIT,
// see ./LICENSE), adapted to this repo's react-hooks rules: the original
// resolved theme/reduced-motion with setState-in-effect subscriptions; here
// both are `useSyncExternalStore` stores (same convention as
// use-hover-capable.ts), reading the root element's `dark`/`light` class or
// `data-theme`: which is where this app's theme toggles land, falling back
// to `prefers-color-scheme`.

import { useSyncExternalStore } from "react";
import type { OrbTheme } from "./types";

function subscribeTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener("change", onChange);
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
  }
  return () => {
    mq?.removeEventListener("change", onChange);
    observer?.disconnect();
  };
}

function rootDark(): boolean {
  if (typeof document === "undefined") return true;
  const root = document.documentElement;
  const attr = root.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  return (
    typeof matchMedia === "undefined" ||
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Resolve the effective dark/light substrate. SSR renders dark first. */
export function useResolvedDark(theme: OrbTheme): boolean {
  const dark = useSyncExternalStore(subscribeTheme, rootDark, () => true);
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return dark;
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function reducedSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

/** Live `prefers-reduced-motion`, reduced users get a static frame. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, reducedSnapshot, () => false);
}
