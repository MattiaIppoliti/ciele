"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** How long "Back online" stays after the connection returns. */
const RECOVERED_MS = 3000;

/**
 * The connection state, shown under the top bar beside the activation banner
 * (#1073). A console that has lost its connection otherwise looks like one
 * whose buttons stopped working: a save fails with a generic error and nothing
 * says why. The server snapshot is "online", so nothing flashes in before
 * hydration reads `navigator.onLine`.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const onOnline = () => {
      window.clearTimeout(timer);
      setRecovered(true);
      timer = window.setTimeout(() => setRecovered(false), RECOVERED_MS);
    };
    const onOffline = () => {
      window.clearTimeout(timer);
      setRecovered(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const state = !online ? "offline" : recovered ? "recovered" : null;
  // The live region stays mounted and only its content changes: a screen
  // reader announces a change inside a region it already knows, not a region
  // that arrives with its text already in it. Empty, it draws nothing.
  return (
    <div
      role="status"
      className={cn(
        state && "flex items-center gap-2 border-b px-4 py-2 text-sm",
        state === "offline" && "bg-tone-amber text-tone-amber-ink",
        state === "recovered" && "bg-tone-green text-tone-green-ink"
      )}
    >
      {state === "recovered" ? (
        <>
          <Wifi aria-hidden className="size-4" />
          <span className="font-medium">Back online</span>
        </>
      ) : state === "offline" ? (
        <>
          <WifiOff aria-hidden className="size-4" />
          <span className="font-medium">You are offline</span>
          <span className="opacity-80">Changes are not saved until the connection is back.</span>
        </>
      ) : null}
    </div>
  );
}
