import { redactFlowsSecrets } from "@agent-hub/core";
import { notFound, redirect } from "next/navigation";
import { AssistantOverview } from "@/components/assistant/assistant-overview";
import { legacyAssistantSectionHref } from "@/components/shell/nav";
import { requirePageMember } from "@/lib/authz";
import { getAssistantCached } from "./get-assistant";

export const dynamic = "force-dynamic";

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

  const { db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  const [flows, collections, publications] = await Promise.all([
    db.listFlows(id).then(redactFlowsSecrets),
    db.listCollections(id),
    db.listPublications(id),
  ]);

  return (
    <AssistantOverview
      assistant={assistant}
      flows={flows}
      collections={collections}
      publications={publications}
    />
  );
}
