import { redactFlowsSecrets } from "@agent-hub/core";
import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/assistant/flow-builder";
import { requirePageMember } from "@/lib/authz";
import { getAssistantCached } from "../get-assistant";

/** Shared deep implementation behind the new-Flow and edit-Flow routes. */
export async function FlowBuilderPage({
  assistantId,
  flowId,
}: {
  assistantId: string;
  flowId: string | null;
}) {
  const { db, reads } = await requirePageMember();
  const assistant = await getAssistantCached(assistantId);
  if (!assistant) notFound();

  const [flows, assistants, trust, helpDesks, collections] = await Promise.all([
    db.listFlows(assistantId).then(redactFlowsSecrets),
    reads.assistants(),
    db.listFlowTrust(assistantId),
    db.listHelpDesks(assistant.organizationId),
    db.listCollections(assistantId),
  ]);
  const concepts = await Promise.all(
    collections.map((collection) => db.listConcepts(collection.id))
  );
  const faqs = concepts
    .flat()
    .filter(
      (concept) =>
        concept.frontmatter.type === "FAQ" &&
        Boolean(concept.frontmatter.title?.trim())
    )
    .map((concept) => ({
      id: concept.id,
      question: concept.frontmatter.title!,
    }));
  const flow = flowId ? (flows.find((candidate) => candidate.id === flowId) ?? null) : null;
  if (flowId && !flow) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-5">
      <FlowBuilder
        assistantId={assistantId}
        flow={flow}
        assistants={assistants
          .filter((candidate) => candidate.id !== assistantId)
          .map((candidate) => ({ id: candidate.id, title: candidate.title }))}
        helpDesks={helpDesks
          .filter((helpDesk) =>
            (assistant.helpDeskSettings.selectedIds ?? []).includes(helpDesk.id)
          )
          .map((helpDesk) => ({ id: helpDesk.id, name: helpDesk.name }))}
        faqs={faqs}
        trust={flow ? (trust.find((entry) => entry.flowId === flow.id) ?? null) : null}
      />
    </div>
  );
}
