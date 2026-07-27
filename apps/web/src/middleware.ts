import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  // Marketing home — also reachable by signed-in users who want to see it.
  /^\/home$/,
  // The rest of the (marketing) route group: static security/legal pages the
  // home footer's "Legal" column links to. No private data, so a signed-out
  // visitor must reach them instead of bouncing to /login?next=.
  /^\/security$/,
  /^\/policies\//,
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

  // Demo mode: no Supabase, no auth.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next();
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

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((re) => re.test(pathname));

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
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|widget.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
