import { NextRequest } from "next/server";
import {
  resolveWidgetContext,
  widgetOptions,
  widgetSubject,
} from "@/lib/widget-db";

// Depends on the per-visitor gate cookie, so never cached.
export const runtime = "nodejs";

/**
 * The widget Memory folder (#666): what the assistant remembers about the
 * SSO-signed end-user, with per-memory delete. The subject comes exclusively
 * from the sealed gate cookie — anonymous visitors (and gates minted for
 * other Organizations) see a 404, as does everyone while the org toggle is
 * off. A user can only ever read or delete their own memories.
 */
async function memoryContext(
  request: NextRequest,
  params: Promise<{ assistantId: string }>
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, cors } = ctx;
  const organizationId = ctx.publication.config.assistant.organizationId;

  const subject = widgetSubject(request, organizationId, "");
  if (subject.type !== "sso" || !(await db.getMemoryEnabled(organizationId))) {
    return new Response("Not found", { status: 404, headers: cors });
  }
  return { db, cors, organizationId, subjectId: subject.id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await memoryContext(request, params);
  if (ctx instanceof Response) return ctx;

  const memories = await ctx.db.listMemories({
    organizationId: ctx.organizationId,
    subjectId: ctx.subjectId,
  });
  return Response.json(
    {
      memories: memories.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt,
      })),
    },
    { headers: { ...ctx.cors, "Cache-Control": "no-store" } }
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await memoryContext(request, params);
  if (ctx instanceof Response) return ctx;

  const id = request.nextUrl.searchParams.get("id") ?? "";
  const memories = await ctx.db.listMemories({
    organizationId: ctx.organizationId,
    subjectId: ctx.subjectId,
  });
  if (!memories.some((m) => m.id === id)) {
    return new Response("Not found", { status: 404, headers: ctx.cors });
  }
  await ctx.db.deleteMemory(id);
  return Response.json({ ok: true }, { headers: ctx.cors });
}

export const OPTIONS = widgetOptions;
