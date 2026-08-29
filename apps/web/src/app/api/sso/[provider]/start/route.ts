import type { NextRequest } from "next/server";
import { startSsoFlow } from "@/lib/sso/handlers";
import { isKnownProviderKind } from "@/lib/sso";

// jose + node:crypto need the Node runtime; the whole flow runs server-side.
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isKnownProviderKind(provider)) {
    return new Response("Unknown provider", { status: 404 });
  }
  return startSsoFlow(request, provider);
}
