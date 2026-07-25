import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  cancelLocalSubscriptionLogin,
  disconnectLocalSubscription,
  getLocalSubscriptionStatus,
  isLocalSubscriptionProvider,
  isLocalSubscriptionTestEnabled,
  isLoopbackHost,
  startLocalSubscriptionLogin,
} from "@/lib/local-subscriptions";
import { clearLocalSubscriptionReadinessProbe } from "@/lib/local-subscription-model";

async function authorize(
  request: NextRequest,
  params: Promise<{ provider: string }>
) {
  if (
    !isLocalSubscriptionTestEnabled() ||
    !isLoopbackHost(request.headers.get("host"))
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  if (!(await db.getPersonalAiSubscriptionsAllowed(session.organization.id))) {
    return Response.json({ error: "personal_subscriptions_disabled" }, { status: 403 });
  }
  const { provider } = await params;
  if (!isLocalSubscriptionProvider(provider)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return provider;
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = await authorize(request, params);
  if (provider instanceof Response) return provider;
  return Response.json(await getLocalSubscriptionStatus(provider), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const provider = await authorize(request, params);
  if (provider instanceof Response) return provider;
  clearLocalSubscriptionReadinessProbe(provider);
  return Response.json(await startLocalSubscriptionLogin(provider), {
    status: 202,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const provider = await authorize(request, params);
  if (provider instanceof Response) return provider;
  clearLocalSubscriptionReadinessProbe(provider);
  try {
    return Response.json(await disconnectLocalSubscription(provider), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Logout failed." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const provider = await authorize(request, params);
  if (provider instanceof Response) return provider;
  cancelLocalSubscriptionLogin(provider);
  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
