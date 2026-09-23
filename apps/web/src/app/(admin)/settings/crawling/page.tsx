import { redirect } from "next/navigation";
import { CrawlerConnectionCard } from "@/components/settings/crawler-connection-card";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";
import { websiteCrawlerCapabilities } from "@agent-hub/agent";

export const dynamic = "force-dynamic";

export default async function CrawlingSettingsPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  // Crawler accounts are org-wide credentials, admins and owners only.
  if (!canManageMembers(role)) redirect("/settings/profile");

  const connection = await db
    .getCrawlerConnection(organizationId, "apify")
    .catch(() => null);

  return (
    <SettingsPanel
      title="Crawling"
      description={`Connect ${session.organization.name}'s own crawler account. Website Sources that run on Apify then use your token and bill your Apify account.`}
    >
      <CrawlerConnectionCard
        connection={
          connection
            ? {
                tokenHint: connection.tokenHint,
                accountId: connection.accountId,
                updatedAt: connection.updatedAt,
              }
            : null
        }
        platformFallback={websiteCrawlerCapabilities().apifyConfigured}
      />
    </SettingsPanel>
  );
}
