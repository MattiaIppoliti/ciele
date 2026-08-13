import { createMcpHandler } from "@modelcontextprotocol/server";
import { CieleClient } from "@ciele/client";
import { createCieleMcpServer } from "@ciele/mcp/server";
import { bearerApiKeySecret, resolveApiKeyContext } from "@/lib/api-v1/auth";

/**
 * The hosted MCP endpoint (#702). The 2026-07-28 revision removed protocol
 * sessions, which is what makes this a plain route handler: every request is
 * self-contained, so no sticky routing and no session store — the reason this
 * was deferred in #613 no longer exists.
 *
 * The same 14 coarse tools the stdio server registers, reached over HTTP with
 * an org API key. `createMcpHandler` serves both protocol eras from one
 * factory (`legacy: 'stateless'` is its default), so a client that has not
 * moved to 2026-07-28 still works.
 *
 * Shipping inside apps/web is what gives self-host parity for free: every
 * deployment — SaaS, Docker self-host, Ciele Desktop's local stack — serves
 * this at its own origin with no configuration.
 */

export const runtime = "nodejs";

const handler = createMcpHandler((ctx) => {
  // The tools reach the Organization the same way the stdio server does —
  // through /api/v1 on this same deployment — so there is exactly one
  // execution path for an operation whatever transport asked for it. The
  // caller's own key is forwarded, so RBAC is enforced where it always was.
  const request = ctx.requestInfo;
  const client = new CieleClient({
    apiKey: bearerApiKeySecret(request?.headers.get("authorization") ?? null) ?? "",
    // This deployment's own origin, taken from the request being served, is
    // what keeps the endpoint configuration-free. It is a loopback, so the
    // origin only has to be reachable *from* the server — behind a reverse
    // proxy an internal origin is the right answer, not a wrong one.
    baseUrl: request ? new URL(request.url).origin : undefined,
  });
  // Read-only is a property of the key's Role here, not an env switch: a
  // Viewer key simply cannot mutate (the operations layer answers 403).
  // `CIELE_MCP_READ_ONLY` stays a local-process convenience on stdio.
  return createCieleMcpServer({ client, readOnly: false });
});

export async function POST(request: Request): Promise<Response> {
  // Validate the key up front so an unauthenticated caller is refused at the
  // door — with the same opaque 401 as /api/v1 — instead of listing tools
  // happily and failing on every call. Only the refusal is used here: the
  // resolved context is deliberately dropped, because the tools re-enter
  // through /api/v1 and it resolves the key there for real.
  const refusal = await resolveApiKeyContext(request);
  if (refusal instanceof Response) return refusal;
  return handler.fetch(request);
}

/**
 * A 2025-era client may probe GET for the old SSE stream, and DELETE to end a
 * session. Neither exists in stateless serving — delegating lets the handler
 * answer them with its own protocol-shaped 405 rather than Next's bare one.
 */
export const GET = (request: Request): Promise<Response> => handler.fetch(request);
export const DELETE = GET;
