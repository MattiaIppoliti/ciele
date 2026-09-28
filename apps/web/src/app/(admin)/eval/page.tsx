import {
  EVALUATION_STAGES,
  modelSelector,
  settleStaleEvaluationRun,
} from "@agent-hub/core";
import { EvalLibrary } from "@/components/eval/eval-library";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { canManageMembers } from "@/lib/rbac";
import { allEvaluationModels, availableEvaluationModels, evaluationModelsForStage } from "@/lib/evaluation-models";
import { isPlatformOwner, listPlatformEvalModels } from "@/lib/platform";

export const dynamic = "force-dynamic";
// `startEvaluationRunAction` runs synchronously from this page.
export const maxDuration = 300;

export default async function EvalPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { organizationId, role, db, session } = await requirePageMember();
  const rawPage = Number((await searchParams).page ?? "1");
  const page =
    Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1;
  const [runs, datasets, assistants, connections, extraModels] = await Promise.all([
    db
      .table("evaluationRuns")
      .list({ organizationId }, { limit: 26, offset: (page - 1) * 25 }),
    db.table("evaluationDatasets").list({ organizationId }, { limit: 100 }),
    db.listAssistants(organizationId),
    db.listProviderConnections(organizationId),
    listPlatformEvalModels(),
  ]);
  const availableModels = availableEvaluationModels(
    connections,
    Boolean(process.env.AI_GATEWAY_API_KEY),
    extraModels,
  );
  const assistantOptions = assistants.map((assistant) => ({
    id: assistant.id,
    title: assistant.title,
    modelProvider: assistant.modelProvider,
    modelId: assistant.modelId,
    modelsByStage: Object.fromEntries(
      EVALUATION_STAGES.map((stage) => [
        stage,
        evaluationModelsForStage(availableModels, stage, assistant.modelProvider),
      ]),
    ) as Record<(typeof EVALUATION_STAGES)[number], typeof availableModels>,
  }));
  const now = new Date();
  return (
    <EvalLibrary
      runs={runs.slice(0, 25).map((run) => settleStaleEvaluationRun(run, now))}
      datasets={datasets}
      assistants={assistantOptions}
      allModels={allEvaluationModels(connections, extraModels)}
      availableModelKeys={availableModels.map(modelSelector)}
      canEdit={canEdit(role)}
      canManageProviders={canManageMembers(role)}
      canManageCatalog={isPlatformOwner(session.email)}
      page={page}
      hasNext={runs.length > 25}
    />
  );
}
