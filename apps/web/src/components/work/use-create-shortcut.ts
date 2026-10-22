"use client";

import { useEffect, useRef } from "react";
import { SHELL_CREATE_EVENT, type ShellCreateKind } from "@/components/shell/shell-hotkeys";

/**
 * Answers the shell's `N` (a Task) or `P` (a Project) on a page that can
 * create one (#1071): the page opens its own dialog, prefilled from where it
 * is, and claims the event so the shell does not navigate elsewhere.
 */
export function useCreateShortcut(kind: ShellCreateKind, onCreate: (() => void) | null) {
  const handler = useRef(onCreate);
  useEffect(() => {
    handler.current = onCreate;
  });
  useEffect(() => {
    const listen = (event: Event) => {
      if ((event as CustomEvent<ShellCreateKind>).detail !== kind || !handler.current) return;
      event.preventDefault();
      handler.current();
    };
    window.addEventListener(SHELL_CREATE_EVENT, listen);
    return () => window.removeEventListener(SHELL_CREATE_EVENT, listen);
  }, [kind]);
}
