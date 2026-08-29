/**
 * The single authentication seam for `/api/cron/*` routes.
 *
 * Every cron endpoint performs cross-org, service-role side effects, so the
 * CRON_SECRET bearer check must be impossible to forget or get subtly wrong
 * in any one route: routes export `GET = withCronAuth(handler)` and never
 * compare the secret inline. Vercel Cron sends the secret as a Bearer token;
 * with no secret configured we refuse to run at all (503) rather than run
 * open.
 */
export function withCronAuth(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return Response.json(
        { error: "CRON_SECRET not configured" },
        { status: 503 }
      );
    }
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return handler(request);
  };
}
