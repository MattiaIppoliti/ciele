import { resolveApiKeyContext } from "@/lib/api-v1/auth";

/**
 * Who a key is (#627): the Organization it is pinned to and the Role it acts
 * with — what `ciele whoami` shows after login. Deliberately minimal: the
 * key's own identity, nothing about other members or keys.
 */
export async function GET(request: Request) {
  const ctx = await resolveApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  return Response.json({
    organizationId: ctx.organizationId,
    role: ctx.role,
    keyId: ctx.keyId,
  });
}
