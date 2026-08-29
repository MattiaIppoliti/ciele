"use client";

import { openCookiePreferences } from "./open-preferences";

/**
 * Inline trigger that reopens the cookie preferences modal, used in the
 * marketing footer and in the body of the Cookie Notice. The console uses the
 * same action from its account menu.
 */
export function CookiePreferencesButton({
  className,
  children = "Cookie preferences",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={className}
      onClick={openCookiePreferences}
    >
      {children}
    </button>
  );
}
