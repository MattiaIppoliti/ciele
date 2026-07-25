import type { NextRequest } from "next/server";
import { handleSsoCallback } from "@/lib/sso/handlers";
import { isKnownProviderKind } from "@/lib/sso";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isKnownProviderKind(provider)) {
    return new Response("Unknown provider", { status: 404 });
  }
  return handleSsoCallback(request, provider);
}
