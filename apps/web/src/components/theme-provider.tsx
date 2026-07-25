"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Scoped to the admin shell only: the published widget and auth pages must
 * stay light — the widget is visitor-facing and themed per assistant, not by
 * the admin's preference (and it shares the chat origin's localStorage).
 *
 * Replaces next-themes: its provider is a client component that renders an
 * inline <script>, which React 19 / Next 16 flags with "Encountered a script
 * tag while rendering React component". We keep the same useTheme() surface
 * but render no client script; the pre-hydration class is set by the
 * server-rendered ThemeScript (see theme-script.tsx), which does not warn.
 */

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  const el = document.documentElement;
  el.classList.remove("light", "dark");
  el.classList.add(resolved);
  el.style.colorScheme = resolved;
}

function storedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy-init from storage/media on the client (SSR falls back to system/light);
  // the provider renders no theme-dependent DOM, so there is no hydration
  // mismatch, and ThemeScript already set the class before paint.
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && systemTheme() === "dark",
  );

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Subscribe to OS theme changes (setState only in the callback — allowed).
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Sync the external system (the <html> element) with the resolved theme.
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        setThemeState((e.newValue as Theme | null) ?? "system");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore — theme still applies for the session via state.
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const FALLBACK: ThemeContextValue = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
};

/** Mirrors next-themes' useTheme; returns a safe default outside a provider. */
export function useTheme() {
  return useContext(ThemeContext) ?? FALLBACK;
}
