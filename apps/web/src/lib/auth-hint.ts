/**
 * The signed-in *hint*: a non-secret, JS-readable cookie whose only job is to
 * let a fully static page draw the right header CTA before first paint.
 *
 * Why it exists. The marketing pages are identical for every visitor except for
 * one button, "Open app" for a signed-in caller, "Log in / Get a demo"
 * otherwise. Resolving that on the server meant reading the session cookie in
 * the (marketing) layout, and a layout that reads cookies makes every route
 * under it dynamic: seven pages re-rendered per request to decide one button.
 *
 * So the pages no longer ask. They render both CTAs, and this hint decides which
 * one is visible, applied to <html> by a blocking inline script before paint (the
 * same trick `theme-script.tsx` uses to avoid a flash of the wrong theme). The
 * pages prerender; the button is still right on the first frame.
 *
 * It is emphatically NOT an auth mechanism:
 *   - it carries no identity, no token and no claim, just "1" or nothing;
 *   - nothing is authorized by it, ever. Every gate stays where it was: the
 *     middleware's validated claims and each page's own session read;
 *   - a stale or forged hint costs a visitor one wrong-looking button. Clicking
 *     "Open app" without a session lands on /login exactly as before.
 *
 * The middleware owns it (see `middleware.ts`), because that is where the session
 * claims are already validated on every request, so the hint self-corrects when
 * a session expires, and signing in or out needs no extra bookkeeping.
 */

/** Cookie name. Value is `"1"` when signed in; the cookie is deleted otherwise. */
export const AUTH_HINT_COOKIE = "ciele_signed_in";

/** Attribute the inline script sets on <html> when the hint is present. */
export const AUTH_HINT_ATTR = "data-signed-in";

/**
 * Whether the hint cookie already says what the validated claims say.
 *
 * The middleware writes the cookie only when this returns false. That matters
 * for more than tidiness: a `Set-Cookie` header on an otherwise-static response
 * stops a CDN caching it, which would undo the prerendering this hint exists to
 * enable. In the steady state, the overwhelming majority of requests, nothing
 * is written and the response stays cacheable.
 */
export function authHintIsCurrent(
  cookieValue: string | undefined,
  signedIn: boolean
): boolean {
  return signedIn ? cookieValue === "1" : cookieValue === undefined;
}

/**
 * Blocking inline script: mirrors the hint cookie onto <html> before first paint.
 *
 * Deliberately tiny and exception-swallowing, if anything here throws, the page
 * still renders and the visitor sees the signed-out CTA, which is the safe
 * default for a page most visitors read while signed out.
 */
export const AUTH_HINT_INIT = `(function(){try{if(document.cookie.split("; ").indexOf("${AUTH_HINT_COOKIE}=1")>-1)document.documentElement.setAttribute("${AUTH_HINT_ATTR}","")}catch(e){}})();`;
