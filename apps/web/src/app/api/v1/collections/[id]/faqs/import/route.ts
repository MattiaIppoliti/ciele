import { importFaqsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { FAQ_CSV_MAX_BYTES, parseFaqCsv } from "@/lib/faq-csv";

/**
 * Bulk FAQ import (#622): multipart with a two-column CSV `file`
 * (question, answer). Invalid rows are reported in `skipped`, never fatal,
 * same contract as the admin app's Import FAQs modal, same parser.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return apiError(400, "invalid_input", "Provide a CSV as a 'file' field");
  }
  if (file.size > FAQ_CSV_MAX_BYTES) {
    return apiError(400, "invalid_input", "File is too large (max 10 MB)");
  }

  const { rows, skipped } = parseFaqCsv(await file.text());
  if (rows.length === 0) {
    return Response.json({ imported: 0, skipped });
  }

  // PRD #726 contract: the caller names the Assistants the FAQs link to
  // (JSON-encoded `assistantIds` multipart field).
  const rawIds = form.get("assistantIds");
  let assistantIds: string[] | undefined;
  if (typeof rawIds === "string" && rawIds) {
    try {
      const parsed: unknown = JSON.parse(rawIds);
      if (Array.isArray(parsed)) assistantIds = parsed.map((id) => String(id));
    } catch {
      return apiError(400, "invalid_input", "assistantIds must be JSON");
    }
  }
  const outcome = await runApiOperation(request, importFaqsOp, {
    collectionId: id,
    fileName: file.name,
    rows,
    assistantIds,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ imported: outcome.result.imported, skipped });
}
