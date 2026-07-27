/**
 * Opens the cookie preferences modal.
 *
 * Withdrawing consent has to be as easy as giving it, so every first-party
 * surface needs a way in: the marketing footer, the Cookie Notice, and the
 * console's account menu. They all call this.
 *
 * The import is dynamic and deferred to call time for two reasons: callers stay
 * free of the consent chunk (the sidebar would otherwise pull ~30 KB into the
 * console's first load), and by the time anyone clicks, the banner has already
 * fetched that chunk, so this resolves to the same module instance that ran the
 * plugin. Using the plugin's own `data-cc` attribute hook instead would not
 * work: it is bound by a one-shot querySelectorAll at init, so any trigger
 * mounted later by a client-side navigation would be dead.
 */
export function openCookiePreferences(): void {
  void import("vanilla-cookieconsent").then((plugin) => {
    plugin.showPreferences();
  });
}
