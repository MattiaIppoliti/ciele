import { redactFlowsSecrets } from "@agent-hub/core";
import { notFound } from "next/navigation";
import { Workflow } from "lucide-react";
import { FlowsList } from "@/components/assistant/flows-list";
import { SectionHero } from "@/components/settings/section-hero";
import { requirePageMember } from "@/lib/authz";
import { getAssistantCached } from "../get-assistant";

export default async function FlowsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db } = await requirePageMember();
  if (!(await getAssistantCached(id))) notFound();
  const [flows, trust] = await Promise.all([
    db.listFlows(id).then(redactFlowsSecrets),
    db.listFlowTrust(id),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8 sm:py-10">
      <SectionHero
        icon={Workflow}
        title="Flows"
        description="Drag flows to set priority. The first matching flow wins."
      />
      <FlowsList assistantId={id} flows={flows} trust={trust} />
    </div>
  );
}
