import {
  EVALUATION_STAGES,
  modelSelector,
  settleStaleEvaluationRun,
  type EvaluationRun,
} from "@agent-hub/core";
import { EvalLibrary } from "@/components/eval/eval-library";
import { clampPageSize } from "@/lib/pagination";
import type { RunFilters } from "@/components/eval/evaluation-runs-table";
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
  searchParams: Promise<{ page?: string; size?: string; stage?: string; assistant?: string; dataset?: string }>;
}) {
  const { organizationId, role, db, session } = await requirePageMember();
  const params = await searchParams;
  const rawPage = Number(params.page ?? "1");
  const pageSize = clampPageSize(params.size);
  const filters: RunFilters = {
    stage: EVALUATION_STAGES.find(stage => stage === params.stage) ?? "",
    assistant: params.assistant ?? "", dataset: params.dataset ?? "",
  };
  const filter: Partial<EvaluationRun> = { organizationId,
    ...(filters.stage ? { stage: filters.stage } : {}),
    ...(filters.assistant ? { assistantId: filters.assistant } : {}),
    ...(filters.dataset ? { datasetId: filters.dataset } : {}),
  };
  const [total, datasets, assistants, connections, extraModels] = await Promise.all([
    db.table("evaluationRuns").count(filter),
    db.table("evaluationDatasets").list({ organizationId }, { limit: 100 }),
    db.listAssistants(organizationId), db.listProviderConnections(organizationId), listPlatformEvalModels(),
  ]);
  const page = Math.min(Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1, Math.max(1, Math.ceil(total / pageSize)));
  const runs = await db.table("evaluationRuns").list(filter, { limit: pageSize, offset: (page - 1) * pageSize });
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
      runs={runs.map((run) => settleStaleEvaluationRun(run, now))}
      datasets={datasets}
      assistants={assistantOptions}
      allModels={allEvaluationModels(connections, extraModels)}
      availableModelKeys={availableModels.map(modelSelector)}
      canEdit={canEdit(role)}
      canManageProviders={canManageMembers(role)}
      canManageCatalog={isPlatformOwner(session.email)}
      page={page}
      pageSize={pageSize}
      total={total}
      filters={filters}
    />
  );
}
