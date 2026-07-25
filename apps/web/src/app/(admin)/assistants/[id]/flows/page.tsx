import { notFound } from "next/navigation";
import { FlowsList } from "@/components/assistant/flows-list";
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
    db.listFlows(id),
    db.listFlowTrust(id),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <FlowsList assistantId={id} flows={flows} trust={trust} />
    </div>
  );
}
