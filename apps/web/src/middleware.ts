import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_HINT_COOKIE, authHintIsCurrent } from "@/lib/auth-hint";
import { isMarketingPath } from "@/lib/console-routes";

// The whole `(marketing)` route group is public through `isMarketingPath`
// (pinned to the filesystem); these are the one-off public paths outside it.
const PUBLIC_PATHS = [
  // Checkout gates itself (see the route): letting middleware bounce it would
  // drop the ?plan= the buyer just picked, since the /login redirect below
  // carries only the pathname.
  /^\/api\/ee\/stripe\/checkout$/,
  // The consent banner runs on the public site, so the visitors whose choice it
  // records are anonymous by definition; the route is its own trust boundary
  // (same-origin + size cap + schema check) and answers 204 regardless.
  /^\/api\/cookie-consent$/,
  /^\/login/,
  // Self-serve signup is closed; /signup is a redirect stub to /contact/sales
  // (see app/signup/page.tsx). Public so signed-out visitors reach the redirect.
  /^\/signup/,
  /^\/join\//,
  /^\/contact\//,
  /^\/widget/,
  /^\/api\/widget/,
  // Widget SSO: anonymous visitors hit these to sign in with the org's IdP,
  // so they must NOT be bounced to the admin /login (the flow has its own
  // sealed-cookie session; see lib/sso).
  /^\/api\/sso\//,
  /^\/api\/local-connector\/relay\/exchange$/,
  // The paired connector polls for inference jobs with its own bearer token
  // (no browser cookies); the route authenticates the device itself.
  /^\/api\/local-connector\/relay\/jobs$/,
  // Secret-free connector runtime for terminal self-service (curl | node).
  /^\/api\/local-connector\/runtime$/,
  // Secret-free install script for the one-command terminal connect flow.
  /^\/api\/local-connector\/install\/(?:sh|ps1)$/,
  // The self-host installer the download page hands out (curl | sh). Public by
  // definition — it names the open-source repo and generates nothing here.
  /^\/install\.sh$/,
];

export async function middleware(request: NextRequest) {
  // Documentation is a separate app served at its own origin (apps/docs, see
  // #410). The legacy ciele.app/docs path is not a route here — without this it
  // hits the auth gate below and dead-ends at a 404 — so send it (and any
  // subpath) to the canonical docs site. Runs first: before the auth gate, and
  // in demo mode too, so a typed /docs link never 404s.
  const docsPath = request.nextUrl.pathname;
  if (docsPath === "/docs" || docsPath.startsWith("/docs/")) {
    const docsOrigin =
      process.env.DOCS_ORIGIN?.replace(/\/$/, "") ?? "https://docs.ciele.app";
    const target = new URL(`${docsOrigin}${docsPath.slice("/docs".length) || "/"}`);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 307);
  }

  // Demo mode: no Supabase, no auth. The mock db hands out a session, so the
  // signed-in hint says so too — otherwise the marketing header would offer a
  // sign-in that means nothing here (see lib/auth-hint.ts).
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const demo = NextResponse.next();
    if (!authHintIsCurrent(request.cookies.get(AUTH_HINT_COOKIE)?.value, true)) {
      demo.cookies.set(AUTH_HINT_COOKIE, "1", {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
      });
    }
    return demo;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Validate the session JWT locally (with asymmetric signing keys the JWKS
  // is fetched once and cached) instead of a network auth.getUser() round
  // trip on every request. On projects still using a legacy symmetric JWT
  // secret, supabase-js transparently falls back to a server-side check —
  // never less correct, only faster. Expired sessions still refresh through
  // the cookie callbacks above.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  /**
   * Mirror the validated claims into the signed-in hint (see lib/auth-hint.ts),
   * which is how the static marketing pages pick their header CTA. Written here
   * because this is where the session is already validated on every request, so
   * the hint self-corrects on expiry and sign-in/out needs no bookkeeping.
   *
   * Only ever written when it disagrees: a Set-Cookie header would stop a CDN
   * caching the prerendered marketing pages, which is the very thing the hint
   * exists to make possible.
   */
  const applyAuthHint = (res: NextResponse) => {
    if (authHintIsCurrent(request.cookies.get(AUTH_HINT_COOKIE)?.value, !!user)) {
      return res;
    }
    if (user) {
      res.cookies.set(AUTH_HINT_COOKIE, "1", {
        path: "/",
        sameSite: "lax",
        // Readable by the inline script by design — it carries no identity.
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
      });
    } else {
      res.cookies.delete({ name: AUTH_HINT_COOKIE, path: "/" });
    }
    return res;
  };

  const { pathname } = request.nextUrl;
  const isPublic =
    isMarketingPath(pathname) || PUBLIC_PATHS.some((re) => re.test(pathname));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    if (pathname === "/") {
      // Signed-out visitors landing on the root get the marketing home;
      // "/" itself stays the app dashboard for authenticated users.
      url.pathname = "/home";
      url.search = "";
    } else {
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
    }
    return applyAuthHint(NextResponse.redirect(url));
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return applyAuthHint(NextResponse.redirect(url));
  }

  return applyAuthHint(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|widget.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
