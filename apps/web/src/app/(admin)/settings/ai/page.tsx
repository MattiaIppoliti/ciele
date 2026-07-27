import { Link } from "@/components/ui/link";
import { ChevronLeft } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AiSettingsClient } from "@/components/settings/ai-settings-client";
import { BudgetCard } from "@/components/settings/budget-card";
import { EmbeddingConnectionCard } from "@/components/settings/embedding-connection-card";
import { PlatformPromptCard } from "@/components/settings/platform-prompt-card";
import { requirePageMember } from "@/lib/authz";
import { getStoredPlatformPrompt, isPlatformOwner } from "@/lib/platform";
import { canManageMembers } from "@/lib/rbac";
import { canChangeRoles } from "@/lib/rbac";
import { connectorInstallationScope } from "@/lib/local-connector-installer";
import { DEFAULT_PLATFORM_PROMPT, providerAvailability } from "@agent-hub/agent";
import {
  isLocalSubscriptionTestEnabled,
  isLoopbackHost,
  listLocalSubscriptionStatuses,
} from "@agent-hub/agent/local-providers";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  // Provider connections are org-wide config — admins and owners only.
  if (!canManageMembers(role)) redirect("/");

  const connections = await db.listProviderConnections(organizationId);
  const owner = isPlatformOwner(session.email);
  const storedPlatformPrompt = owner ? await getStoredPlatformPrompt() : null;
  const canManage = canManageMembers(role);
  const requestHeaders = await headers();
  const localSubscriptionTestEnabled =
    isLocalSubscriptionTestEnabled() &&
    isLoopbackHost(requestHeaders.get("host"));
  const personalSubscriptionsAllowed =
    await db.getPersonalAiSubscriptionsAllowed(organizationId);
  const [
    budget,
    usedToday,
    usedTodayEur,
    compostOptOut,
    localSubscriptionStatuses,
  ] = await Promise.all([
    db.getOrgBudget(organizationId),
    db.getOrgTokensUsedToday(organizationId),
    db.getOrgCostUsedToday(organizationId),
    db.getCompostOptOut(organizationId),
    personalSubscriptionsAllowed && localSubscriptionTestEnabled
      ? listLocalSubscriptionStatuses()
      : [],
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:opacity-70"
          >
            <ChevronLeft className="size-4" strokeWidth={3} />
            All assistants
          </Link>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">AI Providers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose how {session.organization.name}&apos;s assistants reach their models:
          platform plan, your own API keys, or keyless enterprise auth.
        </p>
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
        {storedPlatformPrompt !== null && (
          <PlatformPromptCard
            storedPrompt={storedPlatformPrompt}
            defaultPrompt={DEFAULT_PLATFORM_PROMPT}
          />
        )}
      </div>
    </div>
  );
}
