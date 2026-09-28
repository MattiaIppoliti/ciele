import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  cancelLocalSubscriptionLogin,
  disconnectLocalSubscription,
  getLocalSubscriptionStatus,
  isLocalSubscriptionProvider,
  isLocalSubscriptionDirectEnabled,
  isLoopbackHost,
  startLocalSubscriptionLogin,
} from "@agent-hub/agent/local-providers";
import { clearLocalSubscriptionReadinessProbe } from "@agent-hub/agent/local-providers";

async function authorize(
  request: NextRequest,
  params: Promise<{ provider: string }>
) {
  if (
    !isLocalSubscriptionDirectEnabled() ||
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

/** The mutating verbs also refuse a cross-origin caller, before authorizing. */
async function authorizeMutation(
  request: NextRequest,
  params: Promise<{ provider: string }>
) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  return authorize(request, params);
}

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = await authorize(request, params);
  if (provider instanceof Response) return provider;
  return Response.json(await getLocalSubscriptionStatus(provider), {
    headers: NO_STORE,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = await authorizeMutation(request, params);
  if (provider instanceof Response) return provider;
  clearLocalSubscriptionReadinessProbe(provider);
  return Response.json(await startLocalSubscriptionLogin(provider), {
    status: 202,
    headers: NO_STORE,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = await authorizeMutation(request, params);
  if (provider instanceof Response) return provider;
  clearLocalSubscriptionReadinessProbe(provider);
  try {
    return Response.json(await disconnectLocalSubscription(provider), {
      headers: NO_STORE,
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
  const provider = await authorizeMutation(request, params);
  if (provider instanceof Response) return provider;
  cancelLocalSubscriptionLogin(provider);
  return Response.json({ ok: true }, {
    headers: NO_STORE,
  });
}
