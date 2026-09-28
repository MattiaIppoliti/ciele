"use client";

import { createContext, useContext, useEffect, useId } from "react";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

/**
 * Which forms inside the Settings dialog hold unsaved edits. The dialog owns
 * the set and asks before Escape, the backdrop, the close button or a rail
 * link would unmount a dirty tab. A ref-backed set rather than state: forms
 * report on every keystroke, and nothing needs to re-render when they do.
 */
export interface SettingsDirtyRegistry {
  set(key: string, dirty: boolean): void;
}

export const SettingsDirtyContext = createContext<SettingsDirtyRegistry | null>(
  null,
);

/**
 * Report a form's dirty flag to the Settings dialog, and warn on reload while
 * it is dirty. Outside the dialog only the reload warning applies.
 */
export function useSettingsDirty(dirty: boolean) {
  const registry = useContext(SettingsDirtyContext);
  const key = useId();

  useEffect(() => {
    registry?.set(key, dirty);
    return () => registry?.set(key, false);
  }, [registry, key, dirty]);

  useUnsavedChanges({ dirty });
}
