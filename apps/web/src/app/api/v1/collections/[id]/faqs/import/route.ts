import { importFaqsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { FAQ_CSV_MAX_BYTES, parseFaqCsv } from "@/lib/faq-csv";

/**
 * Bulk FAQ import (#622): multipart with a two-column CSV `file`
 * (question, answer). Invalid rows are reported in `skipped`, never fatal —
 * same contract as the admin app's Import FAQs modal, same parser.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return apiError(400, "invalid_input", "Provide a CSV as a 'file' field");
  }
  if (file.size > FAQ_CSV_MAX_BYTES) {
    return apiError(400, "invalid_input", "File is too large (max 10 MB)");
  }

  const { rows, skipped } = parseFaqCsv(await file.text());
  if (rows.length === 0) {
    return Response.json({ imported: 0, skipped });
  }

  const outcome = await runApiOperation(request, importFaqsOp, {
    collectionId: id,
    fileName: file.name,
    rows,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ imported: outcome.result.imported, skipped });
}
