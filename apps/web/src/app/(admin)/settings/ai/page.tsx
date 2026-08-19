import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AiSettingsClient } from "@/components/settings/ai-settings-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { BudgetCard } from "@/components/settings/budget-card";
import { MemoryCard } from "@/components/settings/memory-card";
import { MemorySubjectsCard } from "@/components/settings/memory-subjects-card";
import { EmbeddingConnectionCard } from "@/components/settings/embedding-connection-card";
import { PlatformPromptCard } from "@/components/settings/platform-prompt-card";
import { requirePageMember } from "@/lib/authz";
import { getStoredPlatformPrompt, isPlatformOwner } from "@/lib/platform";
import { canManageMembers } from "@/lib/rbac";
import { canChangeRoles } from "@/lib/rbac";
import { connectorInstallationScope } from "@/lib/local-connector-installer";
import { DEFAULT_PLATFORM_PROMPT, providerAvailability } from "@agent-hub/agent";
import {
  isLocalSubscriptionDirectEnabled,
  isLoopbackHost,
  listLocalSubscriptionStatuses,
} from "@agent-hub/agent/local-providers";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  // Provider connections are org-wide config, admins and owners only.
  if (!canManageMembers(role)) redirect("/settings/profile");

  const connections = await db.listProviderConnections(organizationId);
  const owner = isPlatformOwner(session.email);
  const storedPlatformPrompt = owner ? await getStoredPlatformPrompt() : null;
  const canManage = canManageMembers(role);
  const requestHeaders = await headers();
  const localSubscriptionTestEnabled =
    isLocalSubscriptionDirectEnabled() &&
    isLoopbackHost(requestHeaders.get("host"));
  const personalSubscriptionsAllowed =
    await db.getPersonalAiSubscriptionsAllowed(organizationId);
  const [
    budget,
    usedToday,
    usedTodayEur,
    compostOptOut,
    memoryEnabled,
    memorySubjects,
    localSubscriptionStatuses,
  ] = await Promise.all([
    db.getOrgBudget(organizationId),
    db.getOrgTokensUsedToday(organizationId),
    db.getOrgCostUsedToday(organizationId),
    db.getCompostOptOut(organizationId),
    db.getMemoryEnabled(organizationId),
    db.listMemorySubjects(organizationId),
    personalSubscriptionsAllowed && localSubscriptionTestEnabled
      ? listLocalSubscriptionStatuses()
      : [],
  ]);

  return (
    <SettingsPanel
      title="AI Provider"
      description={`Choose how ${session.organization.name}'s assistants reach their models: platform plan, your own API keys, or keyless enterprise auth.`}
    >
      <AiSettingsClient
          connections={connections.map((c) => ({ ...c, encryptedKey: null }))}
          availability={providerAvailability(connections)}
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
        <BudgetCard
          dailyTokenLimit={budget?.dailyTokenLimit ?? null}
          dailyEuroLimit={budget?.dailyEuroLimit ?? null}
          enforcement={budget?.enforcement ?? "notify"}
          usedToday={usedToday}
          usedTodayEur={usedTodayEur}
          compostOptOut={compostOptOut}
          canManage={canManage}
        />
        <MemoryCard memoryEnabled={memoryEnabled} canManage={canManage} />
        <MemorySubjectsCard subjects={memorySubjects} canEdit={canManage} />
        {storedPlatformPrompt !== null && (
          <PlatformPromptCard
            storedPrompt={storedPlatformPrompt}
            defaultPrompt={DEFAULT_PLATFORM_PROMPT}
          />
        )}
    </SettingsPanel>
  );
}
