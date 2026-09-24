"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type ColorPalette = "midnight" | "mist-blue";
export type ThemeScope = "admin" | "marketing";

export const THEME_STORAGE_KEY = "theme";
export const MARKETING_THEME_STORAGE_KEY = "ciele-marketing-theme";
export const COLOR_PALETTE_STORAGE_KEY = "ciele-color-palette";
const THEME_CHANGE_EVENT = "ciele-theme-change";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  colorPalette: ColorPalette;
  setColorPalette: (palette: ColorPalette) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readTheme(scope: ThemeScope): Theme {
  if (typeof window === "undefined") return scope === "marketing" ? "light" : "system";
  try {
    const value = window.localStorage.getItem(
      scope === "marketing" ? MARKETING_THEME_STORAGE_KEY : THEME_STORAGE_KEY,
    );
    return value === "light" || value === "dark" || value === "system"
      ? value
      : scope === "marketing"
        ? "light"
        : "system";
  } catch {
    return scope === "marketing" ? "light" : "system";
  }
}

function readPalette(): ColorPalette {
  if (typeof window === "undefined") return "midnight";
  try {
    return window.localStorage.getItem(COLOR_PALETTE_STORAGE_KEY) === "mist-blue"
      ? "mist-blue"
      : "midnight";
  } catch {
    return "midnight";
  }
}

function subscribeSystemTheme(listener: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getSystemThemeSnapshot() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme !== "system") return theme;
  return systemDark ? "dark" : "light";
}

function applyTheme(
  theme: Theme,
  palette: ColorPalette,
  scope: ThemeScope,
  systemDark: boolean,
) {
  const root = document.documentElement;
  const resolved = resolveTheme(theme, systemDark);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  if (scope === "admin") {
    root.dataset.appSurface = "admin";
    root.dataset.colorPalette = palette;
  } else {
    delete root.dataset.appSurface;
    delete root.dataset.colorPalette;
  }
}

export function ThemeProvider({
  children,
  scope = "admin",
}: {
  children: React.ReactNode;
  scope?: ThemeScope;
}) {
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener("storage", listener);
    window.addEventListener(THEME_CHANGE_EVENT, listener);
    return () => {
      window.removeEventListener("storage", listener);
      window.removeEventListener(THEME_CHANGE_EVENT, listener);
    };
  }, []);
  const getSnapshot = useCallback(
    () => `${readTheme(scope)}:${scope === "admin" ? readPalette() : "midnight"}`,
    [scope],
  );
  const getServerSnapshot = useCallback(
    () => `${scope === "marketing" ? "light" : "system"}:midnight`,
    [scope],
  );
  const [theme, colorPalette] = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  ).split(":") as [Theme, ColorPalette];
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    () => false,
  );

  useLayoutEffect(() => {
    applyTheme(theme, colorPalette, scope, systemDark);
  }, [theme, colorPalette, scope, systemDark]);

  useEffect(() => {
    if (scope !== "admin") return;
    return () => {
      delete document.documentElement.dataset.appSurface;
      delete document.documentElement.dataset.colorPalette;
    };
  }, [scope]);

  const setTheme = useCallback((value: Theme) => {
    const key = scope === "marketing" ? MARKETING_THEME_STORAGE_KEY : THEME_STORAGE_KEY;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Keep the selected appearance for this session when storage is blocked.
    }
    applyTheme(value, scope === "admin" ? readPalette() : "midnight", scope, systemDark);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, [scope, systemDark]);

  const setColorPalette = useCallback((value: ColorPalette) => {
    if (scope !== "admin") return;
    try {
      window.localStorage.setItem(COLOR_PALETTE_STORAGE_KEY, value);
    } catch {
      // Keep the selected palette for this session when storage is blocked.
    }
    applyTheme(readTheme(scope), value, scope, systemDark);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, [scope, systemDark]);

  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    return resolveTheme(theme, systemDark);
  }, [theme, systemDark]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
    colorPalette: scope === "admin" ? colorPalette : "midnight",
    setColorPalette,
  }), [theme, resolvedTheme, setTheme, colorPalette, setColorPalette, scope]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
