import { NextRequest } from "next/server";
import { SSO_GATE_COOKIE, isGateValidForOrg } from "@/lib/sso";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

// Per-visitor gate state (depends on the gate cookie), so never cached.
export const runtime = "nodejs";

/**
 * Widget SSO session state for the current visitor: whether this assistant
 * requires sign-in, whether the visitor is already authenticated, and which
 * provider to brand the gate with. The widget calls this on mount (and after a
 * login popup) to decide whether to show the identity gate.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;

  const { assistant } = ctx.publication.config;
  const authenticated =
    !assistant.requireSignIn ||
    isGateValidForOrg(
      request.cookies.get(SSO_GATE_COOKIE)?.value,
      assistant.organizationId
    );
  // Provider is org-level (not in the Publication snapshot), read live.
  const connection = assistant.requireSignIn
    ? await ctx.db.getSsoConnectionPublic(assistant.organizationId)
    : null;

  return Response.json(
    {
      requireSignIn: assistant.requireSignIn,
      authenticated,
      provider: connection?.provider ?? null,
    },
    { headers: { ...ctx.cors, "Cache-Control": "no-store" } }
  );
}

export const OPTIONS = widgetOptions;
