import { AUTH_HINT_INIT } from "@/lib/auth-hint";

/**
 * Blocking inline script that mirrors the signed-in hint cookie onto <html>
 * before first paint, so a fully static page can draw the right header CTA on
 * its first frame. See `lib/auth-hint.ts` for what the hint is and is not.
 *
 * Mounted in the ROOT layout only, for the same reason as `ThemeScript` — a
 * <script> created during a client render never executes and React 19 warns
 * about it, and the root layout is above every client navigation boundary.
 */
export function AuthHintScript() {
  return (
    <script id="auth-hint-init" dangerouslySetInnerHTML={{ __html: AUTH_HINT_INIT }} />
  );
}
