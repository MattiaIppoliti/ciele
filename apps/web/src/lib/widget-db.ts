import { createClient } from "@supabase/supabase-js";
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { type Conversation, type ConversationSubject, type Publication } from "@agent-hub/core";
import { createDb, getMockDb, isSupabaseConfigured, type Db } from "@agent-hub/db";
import { SSO_GATE_COOKIE, gateForOrg, type SsoGatePayload } from "@/lib/sso";

let widgetDb: Db | null = null;

/**
 * Db for the public widget routes: service-role client (bypasses RLS —
 * these routes only ever expose data that belongs to a Publication).
 * Falls back to the anon key (read-mostly) and to the demo store.
 * Module-level singleton: the client is env-configured and stateless
 * (no cookies), so one instance serves every widget request.
 */
export function getWidgetDb(): Db {
  if (!isSupabaseConfigured()) return getMockDb();
  if (!widgetDb) {
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false },
    });
    widgetDb = createDb(client);
  }
  return widgetDb;
}

const publicationTag = (assistantId: string) => `publication:${assistantId}`;

/**
 * The Publication lookup every widget surface goes through. Publications
 * are immutable and "which one is latest" changes only through Publish,
 * so the result is cached (tagged per assistant) and invalidated by
 * invalidatePublication() at the moment of Publish — the widget still
 * always serves the latest Publication, without a Postgres round-trip on
 * every request. The TTL is only a backstop.
 *
 * Demo/mock mode bypasses the cache: the offline suite and the zero-config
 * demo (ADR-0003) rely on deterministic in-memory reads.
 */
export async function getLatestPublicationCached(
  assistantId: string
): Promise<Publication | null> {
  if (!isSupabaseConfigured()) {
    return getMockDb().getLatestPublication(assistantId);
  }
  return unstable_cache(
    () => getWidgetDb().getLatestPublication(assistantId),
    ["publication", assistantId],
    { revalidate: 60 * 60 * 24, tags: [publicationTag(assistantId)] }
  )();
}

/**
 * Called by the Publish/Republish actions (updateTag is server-action-only
 * and gives read-your-own-writes: the new version is live immediately).
 * The tag scheme is private to this module — callers only know "a new
 * Publication exists for this assistant".
 */
export function invalidatePublication(assistantId: string) {
  updateTag(publicationTag(assistantId));
}

/**
 * The Route Handler twin (#623): `updateTag` is Server-Action-only, so the
 * /api/v1 publish endpoints invalidate through `revalidateTag`. Best-effort —
 * outside a request scope (unit tests) Next throws, and cache freshness must
 * never fail the mutation that already committed.
 */
export function invalidatePublicationFromRoute(assistantId: string) {
  try {
    revalidateTag(publicationTag(assistantId), "max");
  } catch {
    // outside a Next request scope
  }
}

/** Everything a widget endpoint starts from once the Publication resolves. */
export interface WidgetContext {
  db: Db;
  assistantId: string;
  /** The snapshot the widget serves — never the live assistant row. */
  publication: Publication;
  /** CORS headers honoring the published allowed-domains list. */
  cors: HeadersInit;
}

/**
 * The shared entrypoint of every public widget route: resolves the latest
 * Publication for the assistant and derives the CORS headers from its
 * allowed domains. Returns a uniform 404 Response when the assistant was
 * never published — callers pass it straight through.
 */
export async function resolveWidgetContext(
  request: { headers: Headers },
  params: Promise<{ assistantId: string }>
): Promise<WidgetContext | Response> {
  const { assistantId } = await params;
  const origin = request.headers.get("origin");
  const db = getWidgetDb();
  const publication = await getLatestPublicationCached(assistantId);
  if (!publication) {
    return Response.json(
      { error: "not_published" },
      { status: 404, headers: widgetCors(origin, []) }
    );
  }
  return {
    db,
    assistantId,
    publication,
    cors: widgetCors(origin, publication.config.assistant.allowedDomains),
  };
}

/**
 * The widget surface's conversation-ownership rule, written once: a Visitor
 * may only act on a conversation that exists, belongs to this assistant, and
 * was started by them. Shared by the history endpoint and the escalation
 * operation.
 */
/** A conversation subject reference: who a request claims to speak for. */
export interface SubjectRef {
  type: ConversationSubject;
  id: string;
}

/** Who a widget request speaks for — see {@link widgetSubject}. */
export interface WidgetSubject extends SubjectRef {
  /** The verified gate payload when type === "sso" (identity claim included). */
  gate: SsoGatePayload | null;
}

/**
 * Resolve the subject a widget request speaks for (#662): a valid SSO gate
 * for the assistant's Organization replaces the client-generated visitor id
 * with the verified OIDC subject — the gate is authoritative and cannot be
 * spoofed or overridden by request-body values. Without a gate, the visitor
 * id stands as before.
 */
export function widgetSubject(
  request: { cookies: { get(name: string): { value: string } | undefined } },
  organizationId: string,
  visitorId: string
): WidgetSubject {
  const gate = gateForOrg(
    request.cookies.get(SSO_GATE_COOKIE)?.value,
    organizationId
  );
  return gate
    ? { type: "sso", id: gate.subjectId, gate }
    : { type: "visitor", id: visitorId, gate: null };
}

/**
 * Conversation ownership on the widget surface: the conversation must belong
 * to this assistant AND to this exact subject (type + id) — an anonymous
 * visitor can never claim an SSO conversation by guessing its subject id.
 */
export function subjectOwnsConversation(
  conversation: Conversation | null,
  assistantId: string,
  subject: SubjectRef
): conversation is Conversation {
  return (
    conversation !== null &&
    conversation.assistantId === assistantId &&
    conversation.subjectType === subject.type &&
    conversation.subjectId === subject.id &&
    subject.id !== ""
  );
}

/** The uniform CORS preflight handler every widget route re-exports. */
export async function widgetOptions(request: { headers: Headers }) {
  return new Response(null, {
    status: 204,
    headers: widgetCors(request.headers.get("origin"), []),
  });
}

/** CORS headers for widget endpoints, honoring the allowed-domains list. */
export function widgetCors(
  origin: string | null,
  allowedDomains: string[] | undefined
): HeadersInit {
  allowedDomains ??= [];
  const allowAll = allowedDomains.length === 0;
  const allowed =
    allowAll ||
    (origin !== null &&
      allowedDomains.some((domain) => {
        try {
          const host = new URL(origin).hostname;
          return host === domain || host.endsWith(`.${domain}`);
        } catch {
          return false;
        }
      }));
  return {
    "Access-Control-Allow-Origin": allowed ? (origin ?? "*") : "null",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
