import { NextRequest } from "next/server";
import { refuseHttpFlow, runHttpFlow } from "@agent-hub/agent";
import { resolveApiKeyContext } from "@/lib/api-v1/auth";
import { apiError } from "@/lib/api-v1/http";
import { createRateLimiter } from "@/lib/rate-limit";
import { getRuntimeDb } from "@/lib/runtime-db";
import { getLatestPublicationCached } from "@/lib/widget-db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A Flow another system calls (#843).
 *
 * The one place a Flow runs without a Visitor. Authorization is an Organization
 * API key rather than a per-Flow secret in the URL: keys are already revocable,
 * role-capped and audited, and a secret stored on the Flow would travel into
 * every Publication snapshot the way `flow-secrets.ts` exists to prevent.
 *
 * The key's Organization is also the perimeter for *which* Flow may be run: the
 * Db it hands back is org-pinned and fail-closed, so a valid key naming another
 * organization's Flow reads as "not found", which is the same answer a
 * made-up id gets. That is deliberate. An endpoint that distinguished the two
 * would enumerate other tenants' Flow ids for anyone holding any key.
 *
 * Any valid key may call, whatever its Role. Running a published Flow is what
 * a Visitor does by typing into the widget with no key at all; the key here
 * identifies the Organization, it does not grant the caller anything a Visitor
 * lacks. What the Flow may do is decided when it is published.
 *
 * The Flow that runs is the one in the Assistant's latest Publication, read
 * the way the widget reads it, so an unsaved draft or an unpublished edit is
 * not callable from outside: "published" means the same thing on every
 * channel, and the run record names the Publication it ran from.
 *
 * Rate limited per key, because every request here runs a Flow that can reach
 * the network and (through a Connector or a webhook) cost money.
 */

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

async function handle(request: NextRequest, flowId: string): Promise<Response> {
  const ctx = await resolveApiKeyContext(request);
  if (ctx instanceof Response) return ctx;

  const decision = limiter.check(`flow-trigger:${ctx.keyId}`);
  if (!decision.allowed) {
    return Response.json(
      { error: { code: "rate_limited", message: "Too many requests for this API key" } },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) },
      }
    );
  }

  // The live row decides whether the Flow exists in this Organization at all;
  // the Publication decides what runs.
  const live = await ctx.db.getFlow(flowId).catch(() => null);
  const publication = live ? await getLatestPublicationCached(live.assistantId) : null;
  const flow = publication?.config.flows.find((candidate) => candidate.id === flowId) ?? null;
  if (live && !flow) {
    return apiError(
      404,
      "not_published",
      "That flow is not in the assistant's current publication. Publish the assistant first."
    );
  }
  const refusal = refuseHttpFlow(flow, request.method);
  if (refusal) {
    switch (refusal.reason) {
      case "not_found":
      case "wrong_trigger":
        // One answer for both: a Flow that is not an inbound one is, from out
        // here, indistinguishable from one that does not exist.
        return apiError(404, "not_found", "No inbound flow with that id");
      case "disabled":
        return apiError(409, "flow_disabled", "That flow is turned off");
      case "method_not_allowed":
        return Response.json(
          {
            error: {
              code: "method_not_allowed",
              message: "That flow does not accept this method",
            },
          },
          { status: 405, headers: { allow: refusal.allowed.join(", ") } }
        );
    }
  }

  const assistant = await ctx.db.getAssistant(flow!.assistantId);
  if (!assistant || !publication) return apiError(404, "not_found", "No inbound flow with that id");

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const headers = Object.fromEntries(request.headers);

  const result = await runHttpFlow({
    // The runtime writes rows the org-pinned view cannot (a webhook gate's
    // subscription, an Improvement), so it gets the service Db, exactly as the
    // widget's own turn does. The key has already decided which Flow may run.
    db: getRuntimeDb(ctx.db),
    assistant,
    flow: flow!,
    publicationId: publication.id,
    request: {
      method: request.method,
      body: await request.text(),
      query,
      headers,
    },
  });

  if (result.status === 204) return new Response(null, { status: 204 });
  return new Response(result.body || null, {
    status: result.status,
    headers: {
      // The Flow's own headers win, except where the route owns the value:
      // `respondHeaders` has already dropped those.
      "content-type": "application/json",
      ...result.headers,
    },
  });
}

/**
 * Next routes by exported verb name, so all five exist and all five are the
 * same function. Which verbs a given Flow actually answers is the Flow's own
 * setting, checked in `refuseHttpFlow`: a 405 with an `Allow` header is a
 * better answer than a 404 from a verb this file forgot to export.
 */
type RouteContext = { params: Promise<{ flowId: string }> };

const route = async (request: NextRequest, { params }: RouteContext) =>
  handle(request, (await params).flowId);

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
