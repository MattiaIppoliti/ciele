import { redactFlowsSecrets } from "@agent-hub/core";
import { notFound, redirect } from "next/navigation";
import { AssistantOverview } from "@/components/assistant/assistant-overview";
import { legacyAssistantSectionHref } from "@/components/shell/nav";
import { requirePageMember } from "@/lib/authz";
import { recentSources } from "@/lib/assistant-overview";
import { getUsageDashboardCached } from "@/lib/insights/dashboard";
import { getAssistantCached } from "./get-assistant";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/** Assistant overview and compatibility adapter for the former ?page= URLs. */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; flowId?: string; c?: string }>;
}) {
  const { id } = await params;
  const legacyHref = legacyAssistantSectionHref(id, await searchParams);
  if (legacyHref) redirect(legacyHref);

  const { db, organizationId } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  // The last seven UTC days, today included: the Activity and Quality cards'
  // window, read through the same cached reader as the Insights dashboards.
  const now = new Date();
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const week = {
    from: new Date(today - 6 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(today).toISOString().slice(0, 10),
    surface: "assistants" as const,
    assistantId: id,
  };

  const [flows, collections, publications, inbox, activity] = await Promise.all([
    db.listFlows(id).then(redactFlowsSecrets),
    db.listCollections(id),
    db.listPublications(id),
    db.getInboxPage(organizationId, { assistantId: id, limit: 5 }),
    getUsageDashboardCached(organizationId, week),
  ]);
  // One read per Collection, both the list and the count derive from it.
  const perCollection = await Promise.all(collections.map((collection) => db.listSources(collection.id)));
  const sources = recentSources(perCollection, 5);
  const sourceCount = new Set(perCollection.flat().map((s) => s.id)).size;

  return (
    <AssistantOverview
      assistant={assistant}
      flows={flows}
      collections={collections}
      publications={publications}
      recentSources={sources}
      sourceCount={sourceCount}
      conversations={inbox.conversations}
      activity={activity.dashboard}
      previousActivity={activity.previous}
      activityWindow={week}
      now={now.toISOString()}
    />
  );
}
