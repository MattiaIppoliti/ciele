"use client";

import { createContext, use, useContext } from "react";
import type { Organization, Profile } from "@agent-hub/core";

/** What the personal tabs need from the session, and nothing an admin would. */
export interface SettingsSessionData {
  email: string;
  profile: Profile | null;
  organization: Organization;
  /** Owner or admin: the tabs of the Organization scope are theirs alone. */
  canManageOrg: boolean;
  demo: boolean;
}

/**
 * The settings layout resolves the session once and hands it down as a
 * promise, so a tab that needs only the signed-in person (Profile) renders
 * without asking the server for the session again. The layout survives a tab
 * switch, so that one read is paid when the dialog opens and never on a switch.
 */
export const SettingsSessionContext =
  createContext<Promise<SettingsSessionData | null> | null>(null);

/** Suspends the tab's own loading boundary until the layout's read lands. */
export function useSettingsSession(): SettingsSessionData | null {
  const promise = useContext(SettingsSessionContext);
  if (!promise) throw new Error("useSettingsSession needs the settings layout");
  return use(promise);
}
