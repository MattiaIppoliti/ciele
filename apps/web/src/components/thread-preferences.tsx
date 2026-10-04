"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ThreadPreference, ThreadTarget } from "@agent-hub/core";
import { listThreadPreferencesAction, setThreadPreferenceAction } from "@/app/thread-actions";
import { toast } from "@/lib/toast";

type ThreadView = "active" | "archived" | "flagged";
const keyOf = (target: ThreadTarget) => `${target.kind === "channel" ? "channel" : "conversation"}:${target.id}`;
function matches(row: ThreadPreference, target: ThreadTarget) {
  return target.kind === "channel" ? row.channelId === target.id : row.conversationId === target.id;
}
interface Preferences {
  ready: boolean;
  busy: (target: ThreadTarget) => boolean;
  setBusy: (key: string, busy: boolean) => void;
  flagged: (target: ThreadTarget) => boolean;
  archived: (target: ThreadTarget) => boolean;
  visible: (target: ThreadTarget, view: ThreadView) => boolean;
  set: (target: ThreadTarget, action: "archive" | "flag", enabled: boolean) => Promise<void>;
  removed: (target: ThreadTarget) => void;
}
const Context = createContext<Preferences | null>(null);
export function ThreadPreferencesProvider({ scope, children }: { scope: Promise<string>; children: ReactNode }) {
  const pathname = usePathname();
  const relevant = pathname.startsWith("/inbox") || pathname.startsWith("/teammates");
  const [rows, setRows] = useState<ThreadPreference[]>([]);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [loadedScope, setLoadedScope] = useState<Promise<string> | null>(null);
  const ready = loadedScope === scope;
  const generation = useRef(0);
  const [busyRows, setBusyRows] = useState<Set<string>>(new Set());
  const setBusy = useCallback((key: string, busy: boolean) => setBusyRows(previous => {
    const next = new Set(previous); if (busy) next.add(key); else next.delete(key); return next;
  }), []);
  const flags = useMemo(() => new Set(rows.map(row => `${row.channelId ? "channel:" + row.channelId : "conversation:" + row.conversationId}:${row.action}`)), [rows]);
  useEffect(() => {
    if (!relevant) return;
    generation.current++;
    let cancelled = false;
    void (async () => {
      // Flight supplies a thenable whose .then need not return another Promise.
      await scope;
      if (cancelled) return;
      setRows([]); setDeleted(new Set());
      const result = await listThreadPreferencesAction();
      if (cancelled) return;
      setRows(result); setLoadedScope(() => scope);
    })().catch(() => { if (!cancelled) toast.error("Could not load conversation preferences. Reload to try again."); });
    return () => { cancelled = true; };
  }, [scope, relevant]);
  const has = (target: ThreadTarget, action: "archive" | "flag") => ready && flags.has(`${keyOf(target)}:${action}`);
  return <Context.Provider value={{
    ready, busy: target => busyRows.has(keyOf(target)), setBusy, flagged: target => has(target, "flag"), archived: target => has(target, "archive"),
    visible: (target, view) => !deleted.has(keyOf(target)) && (view === "archived" ? has(target, "archive") : view === "flagged" ? has(target, "flag") : !has(target, "archive")),
    set: async (target, action, enabled) => {
      const current = generation.current;
      const row = await setThreadPreferenceAction(target, action, enabled);
      if (generation.current === current) setRows(previous => [
        ...previous.filter(item => !(matches(item, target) && item.action === action)),
        ...(row ? [row] : []),
      ]);
    },
    removed: target => setDeleted(previous => new Set(previous).add(keyOf(target))),
  }}>{children}</Context.Provider>;
}
export function useThreadPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("ThreadPreferencesProvider is required");
  return value;
}
export function useThreadListView() { return useState<ThreadView>("active"); }
export function ThreadListControls({ value, onChange }: { value: ThreadView; onChange: (view: ThreadView) => void }) {
  return <div className="flex gap-1 px-1 py-1" role="group" aria-label="Conversation view">
    {(["active", "archived", "flagged"] as const).map(view => <button key={view} type="button" aria-pressed={value === view} onClick={() => onChange(view)} className={`press-control rounded-md px-2 py-1 text-xs capitalize ${value === view ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}>{view.charAt(0).toUpperCase() + view.slice(1)}</button>)}
  </div>;
}

/** A streaming group must finish before its list row can be changed. */
export function useThreadBusy(target: ThreadTarget, busy: boolean) {
  const { setBusy } = useThreadPreferences();
  const key = keyOf(target);
  useEffect(() => {
    setBusy(key, busy);
    return () => setBusy(key, false);
  }, [key, busy, setBusy]);
}
