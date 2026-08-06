import { extractSourceText } from "@agent-hub/agent";
import { isSupabaseConfigured } from "@agent-hub/db";
import { addSourceOp, listSourcesOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { sourceResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";
import { resolveApiKeyContext } from "@/lib/api-v1/auth";
import {
  uploadKnowledgeOriginal,
  validateKnowledgeFile,
} from "@/lib/storage/assets";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";

/**
 * A Collection's Sources (#622). POST accepts either JSON
 * (`{kind:"text", name, text}` or `{kind:"url", url}`) or multipart with a
 * `file` field. Extraction and original-binary storage happen here at the
 * surface; guards + the Source row + the ingestion enqueue live in
 * `addSourceOp`. The response carries the Source's `status` — poll
 * `GET /api/v1/sources/{id}` until it settles.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listSourcesOp, {
    collectionId: id,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ data: outcome.result.map(sourceResource) });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const scope = await idempotencyScope(request, `POST /collections/${id}/sources`);
  return withIdempotency(request, scope, async () => {
    const contentType = request.headers.get("content-type") ?? "";

    let name: string;
    let kind: "text" | "url" | "file";
    let rawText: string;
    let sourceUrl: string | undefined;
    let originalObjectPath: string | undefined;

    try {
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return apiError(400, "invalid_input", "Provide a non-empty 'file' field");
        }
        const validation = validateKnowledgeFile({
          name: file.name,
          size: file.size,
        });
        if (!validation.ok) return apiError(400, "invalid_input", validation.error);

        const extracted = await extractSourceText({
          kind: "file",
          name: file.name,
          bytes: await file.arrayBuffer(),
        });
        name = extracted.name;
        kind = "file";
        rawText = extracted.text;

        if (isSupabaseConfigured() && isSupabaseServiceConfigured()) {
          // Need the org for the storage prefix — resolve the key up front.
          const ctx = await resolveApiKeyContext(request);
          if (ctx instanceof Response) return ctx;
          const stored = await uploadKnowledgeOriginal(
            createSupabaseServiceClient(),
            { organizationId: ctx.organizationId, file }
          );
          originalObjectPath = stored.path;
        }
      } else {
        const body = await request.json().catch(() => null);
        if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
        if (body.kind === "url" && typeof body.url === "string") {
          const extracted = await extractSourceText({ kind: "url", url: body.url });
          name = extracted.name;
          kind = "url";
          rawText = extracted.text;
          sourceUrl = body.url;
        } else if (body.kind === "text" && typeof body.text === "string") {
          const extracted = await extractSourceText({
            kind: "text",
            name: String(body.name ?? "Untitled"),
            text: body.text,
          });
          name = extracted.name;
          kind = "text";
          rawText = extracted.text;
        } else {
          return apiError(
            400,
            "invalid_input",
            'kind must be "text" (with text) or "url" (with url); files go via multipart'
          );
        }
      }
    } catch (error) {
      // Extraction failures (bad PDF, unreachable URL, no extractable text)
      // are the caller's input problem, reported plainly like the web action.
      return apiError(
        400,
        "invalid_input",
        error instanceof Error ? error.message : "Extraction failed"
      );
    }

    const outcome = await runApiOperation(request, addSourceOp, {
      collectionId: id,
      name,
      kind,
      rawText,
      sourceUrl,
      originalObjectPath,
    });
    if (outcome instanceof Response) return outcome;
    return Response.json(sourceResource(outcome.result.source), { status: 201 });
  });
}
