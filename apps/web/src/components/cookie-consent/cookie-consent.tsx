"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

/* Lazy so the ~30 KB of consent plugin + stylesheet never enters the shared
   layout chunk. The banner is not first-paint content, and the widget route
   below never requests the chunk at all. */
const CookieConsentUi = dynamic(
  () => import("./cookie-consent-ui").then((module) => module.CookieConsentUi),
  { ssr: false },
);

/**
 * Mounted once from the root layout, which is what makes coverage complete:
 * every first-party page — marketing, auth, console — gets the banner without
 * anyone having to remember to add it to a new route group.
 */
export function CookieConsent() {
  const pathname = usePathname();

  /* The published widget renders inside our customers' pages. Consent there is
     the host site's to collect under its own notice; showing ours in an iframe
     on someone else's domain would be both wrong and confusing. Excluding it
     also means we no longer measure customer embeds with our own analytics,
     which is the correct outcome for the same reason. */
  if (pathname?.startsWith("/widget")) return null;

  return <CookieConsentUi />;
}
