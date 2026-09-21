import { NextRequest } from "next/server";
import { createVisionReader, extractSourceText } from "@agent-hub/agent";
import { thrownMessage } from "@agent-hub/core";
import {
  ATTACHMENT_MAX_BYTES,
  checkAttachment,
  checkAttachmentAllowance,
  isImageAttachment,
  sealAttachment,
} from "@/lib/attachments";
import { resolveWidgetContext, widgetOptions, widgetSubject } from "@/lib/widget-db";

export const runtime = "nodejs";
/** Reading an image is a model call; a long PDF is parser work. */
export const maxDuration = 60;

/**
 * A Visitor's attachment, read into text and thrown away.
 *
 * The response carries no bytes and the server keeps none: what comes back is
 * a sealed token holding the extracted text, which the chat route opens when
 * the message is sent. Sealing is what makes the round trip safe, because that
 * text lands in the system prompt (see `lib/attachments.ts`).
 *
 * The order here is the order the Knowledge upload learned the hard way
 * (#801, CYB-01): decide whether this caller may upload at all *before*
 * spending a parser on their bytes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, publication, cors } = ctx;
  const config = publication.config;

  if (!config.assistant.attachmentsEnabled) {
    return Response.json(
      { error: "attachments_disabled" },
      { status: 404, headers: cors }
    );
  }

  // Same gate the chat route applies, for the same reason: an enforced
  // assistant does nothing for a Visitor who has not signed in.
  const gated = widgetSubject(request, config.assistant.organizationId, "");
  if (config.assistant.requireSignIn && !gated.gate) {
    return Response.json(
      { error: "sign_in_required" },
      { status: 401, headers: cors }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: cors });
  }
  const file = form.get("file");
  const visitorId = String(form.get("visitorId") ?? "").trim();
  if (!(file instanceof File) || !visitorId) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: cors });
  }

  const subject = gated.gate ? gated.gate.subjectId : visitorId;
  const allowance = checkAttachmentAllowance(
    `${config.assistant.id}:${subject}`
  );
  if (!allowance.allowed) {
    return Response.json(
      { error: "too_many", retryAfterMs: allowance.retryAfterMs },
      { status: 429, headers: cors }
    );
  }

  const check = checkAttachment({ name: file.name, size: file.size });
  if (!check.ok) {
    return Response.json(
      { error: "unsupported", message: check.reason },
      { status: 415, headers: cors }
    );
  }
  // Belt and braces against a lying `size`: the body is already here, so this
  // costs nothing and the parser never sees more than the cap.
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    return Response.json(
      { error: "too_large" },
      { status: 413, headers: cors }
    );
  }

  // Only built when it is needed: an org with no credential can still attach a
  // PDF, and only an image asks for a model.
  let vision;
  if (isImageAttachment(file.name)) {
    const connections = await db.listProviderConnections(
      config.assistant.organizationId
    );
    vision =
      createVisionReader(
        connections,
        {
          provider: config.assistant.modelProvider,
          modelId: config.assistant.modelId,
        },
        // Published traffic, so no personal subscription may answer this
        // (ADR-0001, ADR-0007): reading a Visitor's image is the Organization's
        // cost, never a Member's.
        { surface: "published" }
      ) ?? undefined;
  }

  try {
    const extracted = await extractSourceText({
      kind: "file",
      name: file.name,
      bytes,
      vision,
    });
    return Response.json(
      {
        name: extracted.name,
        chars: extracted.text.length,
        token: sealAttachment({ name: extracted.name, text: extracted.text }),
      },
      { headers: cors }
    );
  } catch (error) {
    // Triage refusals and parser failures both land here, and both are the
    // Visitor's to act on: a macro-enabled workbook and an unreadable scan are
    // different sentences, and `extractSourceText` already wrote them.
    return Response.json(
      { error: "unreadable", message: thrownMessage(error, "That file could not be read.") },
      { status: 422, headers: cors }
    );
  }
}

export const OPTIONS = widgetOptions;
