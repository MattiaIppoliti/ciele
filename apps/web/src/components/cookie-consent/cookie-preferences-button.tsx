"use client";

import { openCookiePreferences } from "./open-preferences";
import { Button } from "@agent-hub/ui";

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
    <Button variant="ghost" size="sm"
      type="button"
      aria-haspopup="dialog"
      className={className}
      onClick={openCookiePreferences}
    >
      {children}
    </Button>
  );
}
