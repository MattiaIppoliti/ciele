import { canEditTeammate, EVALUATION_STAGES, type EvaluationStage } from "@agent-hub/core";
import { TeammateDefaultModelSettings } from "@/components/settings/teammate-default-model-settings";
import { DefaultModelSettings } from "@/components/settings/default-model-settings";
import { availableEvaluationModels, evaluationModelsForStage } from "@/lib/evaluation-models";
import { Sparkles } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AiSettingsClient } from "@/components/settings/ai-settings-client";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { BudgetCard } from "@/components/settings/budget-card";
import { MemoryCard } from "@/components/settings/memory-card";
import { MemorySubjectsCard } from "@/components/settings/memory-subjects-card";
import { EmbeddingConnectionCard } from "@/components/settings/embedding-connection-card";
import { PlatformPromptCard } from "@/components/settings/platform-prompt-card";
import { PlatformModelCatalogCard } from "@/components/settings/platform-model-catalog-card";
import { requirePageMember } from "@/lib/authz";
import {
  getStoredPlatformPrompt,
  isPlatformOwner,
  listPlatformEvalModels,
} from "@/lib/platform";
import { canManageMembers } from "@/lib/rbac";
import { canChangeRoles } from "@/lib/rbac";
import { connectorInstallationScope } from "@/lib/local-connector-installer";
import { DEFAULT_PLATFORM_PROMPT } from "@agent-hub/agent";
import {
  isLocalSubscriptionDirectEnabled,
  isLoopbackHost,
  listLocalSubscriptionStatuses,
} from "@agent-hub/agent/local-providers";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  const owner = isPlatformOwner(session.email);
  const canManage = canManageMembers(role);
  // Organization provider settings require its admin role. A platform admin
  // without it reaches this page only for the platform-wide cards: the shared
  // model catalog and the platform prompt, never this org's connections.
  if (!canManage && !owner) redirect("/settings/profile");

  // Independent reads go out together: this page used to chain four to six
  // round trips where two were needed, and each one is a full database hop.
  const [storedPlatformPrompt, platformModels] = await Promise.all([
    owner ? getStoredPlatformPrompt() : null,
    listPlatformEvalModels(),
  ]);
  const platformCards = owner && (
    <>
      <PlatformModelCatalogCard models={platformModels} />
      {storedPlatformPrompt !== null && (
        <PlatformPromptCard
          storedPrompt={storedPlatformPrompt}
          defaultPrompt={DEFAULT_PLATFORM_PROMPT}
        />
      )}
    </>
  );
  if (!canManage) {
    return (
      <SettingsPanel
        icon={Sparkles}
        title="AI Provider"
        description="Applies to every organization."
      >
        <SectionTimeline>
          <TimelineSection title="Platform">{platformCards}</TimelineSection>
        </SectionTimeline>
      </SettingsPanel>
    );
  }

  const requestHeaders = await headers();
  const localSubscriptionTestEnabled =
    isLocalSubscriptionDirectEnabled() &&
    isLoopbackHost(requestHeaders.get("host"));
  const [
    connections,
    assistants,
    teammates,
    personalSubscriptionsAllowed,
    budget,
    usedToday,
    usedTodayEur,
    compostOptOut,
    memoryEnabled,
    memorySubjects,
  ] = await Promise.all([
    db.listProviderConnections(organizationId),
    db.listAssistants(organizationId),
    db.table("teammates").list({ organizationId, deletedAt: null }),
    db.getPersonalAiSubscriptionsAllowed(organizationId),
    db.getOrgBudget(organizationId),
    db.getOrgTokensUsedToday(organizationId),
    db.getOrgCostUsedToday(organizationId),
    db.getCompostOptOut(organizationId),
    db.getMemoryEnabled(organizationId),
    db.listMemorySubjects(organizationId),
  ]);
  const availableModels = availableEvaluationModels(connections, Boolean(process.env.AI_GATEWAY_API_KEY), platformModels);
  const assistantOptions = assistants.map(assistant => ({
    id: assistant.id,
    title: assistant.title,
    modelsByStage: Object.fromEntries(EVALUATION_STAGES.map(stage => [
      stage, evaluationModelsForStage(availableModels, stage, assistant.modelProvider),
    ])) as Record<EvaluationStage, typeof availableModels>,
  }));
  // Only a local development host with the toggle on probes the CLIs, so this
  // stays out of the parallel batch that every request pays for.
  const localSubscriptionStatuses =
    personalSubscriptionsAllowed && localSubscriptionTestEnabled
      ? await listLocalSubscriptionStatuses()
      : [];

  return (
    <SettingsPanel
      icon={Sparkles}
      title="AI Provider"

    >
      <SectionTimeline>
      <TimelineSection title="Default models">
        <DefaultModelSettings assistants={assistantOptions} canEdit={canManage} />
        <TeammateDefaultModelSettings teammates={teammates.filter(teammate => role !== null && canEditTeammate(teammate, { userId: session.userId, role })).map(teammate => ({ id: teammate.id, name: teammate.name, modelProvider: teammate.modelProvider, modelId: teammate.modelId }))} models={evaluationModelsForStage(availableModels, "answer", "anthropic")} />
      </TimelineSection>
      <TimelineSection title="Provider connections">
      <AiSettingsClient
          connections={connections.map((c) => ({ ...c, encryptedKey: null }))}
          canManage={canManage}
          canEnablePersonalSubscriptions={canChangeRoles(role)}
          personalSubscriptionsAllowed={personalSubscriptionsAllowed}
          localSubscriptionTestEnabled={localSubscriptionTestEnabled}
          localSubscriptionStatuses={localSubscriptionStatuses}
          connectorScope={connectorInstallationScope(
            organizationId,
            session.userId
          )}
        />
        <EmbeddingConnectionCard
          connections={connections.map((c) => ({ ...c, encryptedKey: null }))}
          canManage={canManage}
        />
      </TimelineSection>
      <TimelineSection title="Budget">
        <BudgetCard
          dailyTokenLimit={budget?.dailyTokenLimit ?? null}
          dailyEuroLimit={budget?.dailyEuroLimit ?? null}
          enforcement={budget?.enforcement ?? "notify"}
          usedToday={usedToday}
          usedTodayEur={usedTodayEur}
          compostOptOut={compostOptOut}
          canManage={canManage}
        />
      </TimelineSection>
      <TimelineSection title="Memory">
        <MemoryCard memoryEnabled={memoryEnabled} canManage={canManage} />
        <MemorySubjectsCard subjects={memorySubjects} canEdit={canManage} />
      </TimelineSection>
        {owner ? <TimelineSection title="Platform">{platformCards}</TimelineSection> : null}
      </SectionTimeline>
    </SettingsPanel>
  );
}
