"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const snapshot = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverSnapshot = () => null;
/** The browser zone is unknown during server rendering. */
export function useBrowserTimezone() { return useSyncExternalStore(subscribe, snapshot, serverSnapshot); }
export function localExportHour(hour: number, timezone: string | null) {
  if (!timezone) return "…";
  const value = new Date(); value.setUTCHours(hour, 0, 0, 0);
  return `${value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: timezone })} (${timezone})`;
}
