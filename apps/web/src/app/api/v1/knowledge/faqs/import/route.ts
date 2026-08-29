import { importOrgFaqsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { FAQ_CSV_MAX_BYTES, parseFaqCsv } from "@/lib/faq-csv";

/**
 * Org-level bulk FAQ import (PRD #726): a two-column CSV (question, answer)
 * plus an `assistantIds` JSON field naming the links.
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return apiError(400, "invalid_input", "Multipart field 'file' is required");
  }
  if (file.size > FAQ_CSV_MAX_BYTES) {
    return apiError(400, "invalid_input", "File exceeds the 10MB limit");
  }
  let assistantIds: unknown = [];
  try {
    assistantIds = JSON.parse(String(formData?.get("assistantIds") ?? "[]"));
  } catch {
    return apiError(400, "invalid_input", "'assistantIds' must be JSON");
  }
  const { rows, skipped } = parseFaqCsv(await file.text());
  const outcome = await runApiOperation(request, importOrgFaqsOp, {
    fileName: file.name,
    rows,
    assistantIds,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ imported: outcome.result.imported, skipped });
}
