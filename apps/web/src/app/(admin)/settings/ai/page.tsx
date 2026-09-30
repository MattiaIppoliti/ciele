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
    owner ? listPlatformEvalModels() : [],
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
        description="Platform-wide model settings for every Ciele organization."
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
    personalSubscriptionsAllowed,
    budget,
    usedToday,
    usedTodayEur,
    compostOptOut,
    memoryEnabled,
    memorySubjects,
  ] = await Promise.all([
    db.listProviderConnections(organizationId),
    db.getPersonalAiSubscriptionsAllowed(organizationId),
    db.getOrgBudget(organizationId),
    db.getOrgTokensUsedToday(organizationId),
    db.getOrgCostUsedToday(organizationId),
    db.getCompostOptOut(organizationId),
    db.getMemoryEnabled(organizationId),
    db.listMemorySubjects(organizationId),
  ]);
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
      description={`Choose how ${session.organization.name}'s assistants reach their models: platform plan, your own API keys, or keyless enterprise auth.`}
    >
      <SectionTimeline>
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
