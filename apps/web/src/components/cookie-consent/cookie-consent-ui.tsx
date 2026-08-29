"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import * as ConsentPlugin from "vanilla-cookieconsent";
import {
  buildConsentConfig,
  OPTIONAL_CATEGORIES,
  withdrawableKeys,
} from "@/lib/cookie-consent";
import { reportConsent } from "./report-consent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import "./cookie-consent.css";

/**
 * The banner itself, plus the analytics scripts it gates. Loaded lazily by
 * `<CookieConsent />`: never import this directly, or the plugin lands in the
 * shared layout chunk that the embedded widget also downloads.
 *
 * Owning <Analytics/> here rather than in the root layout is the point: it makes
 * "no consent, no tracker" a structural property of the tree instead of a
 * convention someone has to remember. A banner that appears after the trackers
 * already ran is worse than no banner, because it documents the violation.
 *
 * Vercel's analytics happen to be cookieless, so a narrow reading of ePrivacy
 * would let them run unasked. We gate them anyway, it costs one conditional and
 * keeps the notice honest about the one place we measure anything.
 */
export function CookieConsentUi() {
  useEffect(() => {
    void ConsentPlugin.run(buildConsentConfig());
    /* Refusing a category has to remove what it stored, not just stop new
       writes, otherwise the identifier survives the refusal. The plugin's own
       `autoClear` only erases cookies, and everything our optional categories
       persist is in local storage, so we sweep it ourselves. Runs on every
       consent event (not only on change) so storage written under an older
       revision, or left behind by a failed clear, is still cleaned up. */
    const sweep = () => {
      for (const category of OPTIONAL_CATEGORIES) {
        if (ConsentPlugin.acceptedCategory(category.id)) continue;
        for (const key of withdrawableKeys(category.id, Object.keys(localStorage))) {
          localStorage.removeItem(key);
        }
      }
    };
    /* Our own record of the decision (GDPR Art. 7(1)), the visitor's cookie is
       evidence they hold and can erase, so it cannot discharge our
       accountability on its own.

       Bound to `onFirstConsent` and `onChange` only, deliberately NOT to
       `onConsent`: that one fires on every page load where a valid choice
       already exists, which would append a row per page view and bury the
       actual decisions in noise. */
    const reportGranted = () => reportConsent("granted");
    const reportChanged = () => reportConsent("changed");

    window.addEventListener("cc:onConsent", sweep);
    window.addEventListener("cc:onChange", sweep);
    window.addEventListener("cc:onFirstConsent", reportGranted);
    window.addEventListener("cc:onChange", reportChanged);
    return () => {
      window.removeEventListener("cc:onConsent", sweep);
      window.removeEventListener("cc:onChange", sweep);
      window.removeEventListener("cc:onFirstConsent", reportGranted);
      window.removeEventListener("cc:onChange", reportChanged);
    };
  }, []);

  /* Consent lives outside React, in a cookie the plugin owns. Reading it through
     useSyncExternalStore keeps the two in step without a setState in an effect,
     and closes the race where an existing cookie is restored before this
     component subscribed: React re-reads the snapshot on subscribe. */
  const analyticsAllowed = useSyncExternalStore(
    subscribeToConsentChanges,
    () => ConsentPlugin.acceptedCategory("analytics"),
    () => false,
  );

  /* Unmounting the components is not enough to undo a withdrawal: the vendor
     scripts are injected outside React's tree and, once evaluated, keep their
     globals and listeners for the life of the document, a script cannot be
     un-loaded. So on a true→false transition we reload, which is the only way
     to genuinely stop collection in the current session. It only ever fires
     right after the visitor clicked reject in the modal, so the navigation is
     an expected consequence of their own action rather than a surprise. */
  const wasAllowed = useRef(false);
  useEffect(() => {
    if (analyticsAllowed) {
      wasAllowed.current = true;
      return;
    }
    if (wasAllowed.current) window.location.reload();
  }, [analyticsAllowed]);

  if (!analyticsAllowed) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}

function subscribeToConsentChanges(onStoreChange: () => void) {
  // `cc:onConsent` fires on load once a valid choice exists; `cc:onChange` fires
  // when the visitor edits or withdraws it, so a change takes effect in the
  // current page rather than at the next navigation.
  window.addEventListener("cc:onConsent", onStoreChange);
  window.addEventListener("cc:onChange", onStoreChange);
  return () => {
    window.removeEventListener("cc:onConsent", onStoreChange);
    window.removeEventListener("cc:onChange", onStoreChange);
  };
}
