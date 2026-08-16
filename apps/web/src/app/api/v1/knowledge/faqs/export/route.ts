import { listOrgFaqsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
import { serializeFaqCsv } from "@/lib/faq-csv";

/** Org-wide FAQ export: the same two-column CSV the hub's Export produces. */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listOrgFaqsOp, {});
  if (outcome instanceof Response) return outcome;
  const csv = serializeFaqCsv(
    outcome.result.map((e) => ({ question: e.question, answer: e.answer }))
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="faqs.csv"',
    },
  });
}
