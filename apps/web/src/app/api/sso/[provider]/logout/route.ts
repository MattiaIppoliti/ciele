import type { NextRequest } from "next/server";
import { logoutSsoFlow } from "@/lib/sso/handlers";
import { isKnownProviderKind } from "@/lib/sso";

export const runtime = "nodejs";

async function handle(
  request: NextRequest,
  params: Promise<{ provider: string }>
) {
  const { provider } = await params;
  if (!isKnownProviderKind(provider)) {
    return new Response("Unknown provider", { status: 404 });
  }
  return logoutSsoFlow(request);
}

// POST: app-initiated logout. GET: the provider's front-channel logout URL is
// invoked by the IdP as a browser navigation (GET), so both clear the cookie.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  return handle(request, params);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  return handle(request, params);
}
