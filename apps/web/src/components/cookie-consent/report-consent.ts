import * as ConsentPlugin from "vanilla-cookieconsent";

/** Where decisions are recorded. Kept next to the caller so both agree. */
export const CONSENT_LOG_ENDPOINT = "/api/cookie-consent";

/**
 * Sends one consent decision to our server-side record (GDPR Art. 7(1)).
 *
 * Fire-and-forget by design. The visitor's choice is already applied locally and
 * stored in their own cookie, so a failed report must never block them — it is
 * our accountability record that suffers, which is why the endpoint logs its own
 * failures rather than reporting back.
 *
 * `sendBeacon` and not `fetch`: withdrawing analytics consent triggers a page
 * reload (an already-evaluated tracker script cannot be un-loaded), and an
 * in-flight `fetch` would be cancelled by that navigation — losing exactly the
 * withdrawal record we are most obliged to keep. Beacons are queued by the
 * browser and survive it. `fetch` with `keepalive` is the fallback for browsers
 * without `sendBeacon`.
 */
export function reportConsent(action: "granted" | "changed"): void {
  const cookie = ConsentPlugin.getCookie();
  const preferences = ConsentPlugin.getUserPreferences();
  // No consentId means the plugin has not written a decision yet; there is
  // nothing to evidence.
  if (!cookie?.consentId) return;

  const payload = JSON.stringify({
    consentId: cookie.consentId,
    revision: cookie.revision ?? 0,
    acceptedCategories: preferences.acceptedCategories ?? [],
    rejectedCategories: preferences.rejectedCategories ?? [],
    acceptType: preferences.acceptType,
    action,
    // The plugin keeps both stamps; a change is evidenced by the later one.
    consentedAt:
      action === "granted"
        ? (cookie.consentTimestamp ?? null)
        : (cookie.lastConsentTimestamp ?? cookie.consentTimestamp ?? null),
    // Origin + path only — the endpoint strips query and fragment anyway, but
    // there is no reason to put them on the wire in the first place.
    pageUrl: `${window.location.origin}${window.location.pathname}`,
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(CONSENT_LOG_ENDPOINT, blob)) return;
    }
    void fetch(CONSENT_LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Swallowed: see the fire-and-forget note above.
    });
  } catch {
    // Ditto — a blocked beacon must not break the consent UI.
  }
}
