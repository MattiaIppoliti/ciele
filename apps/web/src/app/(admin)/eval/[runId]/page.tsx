import { notFound } from "next/navigation";
import { settleStaleEvaluationRun } from "@agent-hub/core";
import { EvaluationDashboard } from "@/components/eval/evaluation-dashboard";
import { requirePageMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function EvaluationRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { organizationId, db } = await requirePageMember();
  const run = await db.table("evaluationRuns").get(runId);
  if (!run || run.organizationId !== organizationId) notFound();
  return <EvaluationDashboard run={settleStaleEvaluationRun(run, new Date())} />;
}
