"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * A composer's unsent text, kept in this browser per conversation so a reload
 * or a wander to another page does not lose it. Storage is a convenience: a
 * private window or a full quota simply means the draft is not kept.
 *
 * Read through `useSyncExternalStore` so the server and the first client
 * render agree (both start empty) and the stored text arrives after
 * hydration; written in the setter itself, so nothing waits on an effect.
 */
const PREFIX = "ciele.chat-draft:";

function read(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Keep `text` as the draft under `key`, or forget it when empty. */
export function storeChatDraft(key: string, text: string) {
  try {
    if (text) localStorage.setItem(PREFIX + key, text);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    // Private window or a full quota: the draft lives for this page only.
  }
}

export function useChatDraft(key: string): readonly [string, (next: string) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(key), () => "");
  // What was typed in this tab, for this key; until then, what was stored.
  const [typed, setTyped] = useState<{ key: string; value: string } | null>(null);
  const value = typed?.key === key ? typed.value : stored;
  const setValue = (next: string) => {
    setTyped({ key, value: next });
    storeChatDraft(key, next);
  };
  return [value, setValue] as const;
}
