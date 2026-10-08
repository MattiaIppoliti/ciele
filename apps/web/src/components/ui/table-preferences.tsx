"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

const PreferenceScope = createContext<string | null>(null);
/** Resolves the streamed identity without holding up the console shell. */
export function TablePreferenceScope({ scope, children }: { scope: Promise<string>; children: ReactNode }) {
  const [resolved, setResolved] = useState<{ promise: Promise<string>; value: string } | null>(null);
  useEffect(() => {
    let active = true;
    void scope.then((value) => { if (active) setResolved({ promise: scope, value }); });
    return () => { active = false; };
  }, [scope]);
  return <PreferenceScope value={resolved?.promise === scope ? resolved.value : null}>{children}</PreferenceScope>;
}

const changeEvent = "ciele-table-order";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changeEvent, listener);
  };
}

/** Browser-only column order: no data write or shared server order. */
export function useTableOrder(table: string) {
  const scope = useContext(PreferenceScope);
  const key = scope ? `ciele.table-order.${scope}.${table}.columns` : null;
  const [fallback, setFallback] = useState<{ key: string | null; value: string } | null>(null);
  const raw = useSyncExternalStore(subscribe, () => {
    if (!key) return null;
    try { return localStorage.getItem(key); } catch { return null; }
  }, () => null);
  const snapshot = raw ?? (fallback?.key === key ? fallback.value : null);
  let order: string[] = [];
  try {
    const parsed: unknown = snapshot ? JSON.parse(snapshot) : null;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string") && new Set(parsed).size === parsed.length) order = parsed;
  } catch { /* A corrupt preference falls back to the server's order. */ }
  return [order, (next: string[]) => {
    const value = JSON.stringify(next);
    try {
      if (key) { localStorage.setItem(key, value); setFallback(null); }
      else setFallback({ key, value });
    } catch { setFallback({ key, value }); }
    window.dispatchEvent(new Event(changeEvent));
  }] as const;
}
