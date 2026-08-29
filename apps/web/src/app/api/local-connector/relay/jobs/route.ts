import { NextRequest } from "next/server";
import type { LocalSubscriptionProvider } from "@agent-hub/agent/local-providers";
import {
  claimRelayJob,
  completeRelayJob,
} from "@/lib/local-inference-relay";

function providersOf(value: unknown): LocalSubscriptionProvider[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (provider): provider is LocalSubscriptionProvider =>
      provider === "openai" || provider === "anthropic"
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { providers?: unknown };
  const claimed = await claimRelayJob({
    authorization: request.headers.get("authorization"),
    providers: providersOf(body.providers),
  });
  if (!claimed) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ job: claimed.job }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    jobId?: string;
    result?: { text: string; inputTokens?: number; outputTokens?: number };
    error?: string;
  };
  if (!body.jobId) return Response.json({ error: "invalid_job" }, { status: 400 });
  const completed = await completeRelayJob({
    authorization: request.headers.get("authorization"),
    jobId: body.jobId,
    result: body.result,
    error: body.error,
  });
  return completed
    ? Response.json({ ok: true })
    : Response.json({ error: "unauthorized_or_stale" }, { status: 403 });
}
