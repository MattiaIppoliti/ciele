"use client";

import { useEffect, useEffectEvent } from "react";
import { useRouter } from "next/navigation";
import { isApplicationConnectedMessage } from "@/lib/application-connected";
import { toast } from "@/lib/toast";

/**
 * Reacts to the OAuth popup reporting a completed Application connection: the
 * callback page (`api/applications/oauth/[provider]/callback`) posts one
 * message to its opener and closes, and the opener refreshes so the new
 * Connection appears in whatever list it was rendering. Three surfaces open
 * that popup (the Applications tab, the Connector step, the Human review
 * mailbox picker) and each used to carry its own copy of the listener.
 *
 * `onConnected` reads the latest render's closure, so a caller may pass an
 * inline function without re-subscribing on every render.
 */
export function useApplicationConnected(onConnected?: (provider: string) => void): void {
  const router = useRouter();
  const connected = useEffectEvent((provider: string) => {
    onConnected?.(provider);
    router.refresh();
  });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!isApplicationConnectedMessage(event, window.location.origin)) return;
      connected(event.data.provider);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
}

/** The default reaction: a toast with the surface's wording, then the refresh. */
export function useApplicationConnectedToast(message: string): void {
  useApplicationConnected(() => toast.success(message));
}
