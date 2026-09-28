import { notFound } from "next/navigation";
import { modelSelector, settleStaleEvaluationRun } from "@agent-hub/core";
import { EvaluationDashboard } from "@/components/eval/evaluation-dashboard";
import { requirePageMember } from "@/lib/authz";
import { allEvaluationModels } from "@/lib/evaluation-models";
import { listPlatformEvalModels } from "@/lib/platform";

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
  const labels = Object.fromEntries(
    allEvaluationModels([], await listPlatformEvalModels()).map((model) => [
      modelSelector(model),
      model.label,
    ]),
  );
  return (
    <EvaluationDashboard
      run={settleStaleEvaluationRun(run, new Date())}
      labels={labels}
    />
  );
}
