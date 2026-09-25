"use client";

import { useSyncExternalStore } from "react";

// The public widget can use a theme different from the device's preference.
function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const currentTheme = () => document.documentElement.classList.contains("dark") ? "dark" as const : "light" as const;
const serverTheme = () => "light" as const;

export function useRenderedTheme() {
  return useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
}
