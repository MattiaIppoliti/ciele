import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/assistant/flow-builder";
import { requirePageMember } from "@/lib/authz";
import { loadFlowBuilderCatalogue } from "@/lib/flow-builder-catalogue";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

/** Shared deep implementation behind the new-Flow and edit-Flow routes. */
export async function FlowBuilderPage({
  assistantId,
  flowId,
}: {
  assistantId: string;
  flowId: string | null;
}) {
  const { db, reads, role, session } = await requirePageMember();
  const assistant = await getAssistantCached(assistantId);
  if (!assistant) notFound();

  // The catalogue is shared with the Flows Agent route (#838), so what the
  // builder offers and what the agent is told are one read.
  const [
    { flows, helpDesks, faqs, connections },
    assistants,
    trust,
    providerConnections,
    personalSubscriptionsAllowed,
  ] = await Promise.all([
    loadFlowBuilderCatalogue(db, assistant, session.userId),
    reads.assistantShellSummaries(),
    db.listFlowTrust(assistantId),
    db.listProviderConnections(assistant.organizationId),
    db.getPersonalAiSubscriptionsAllowed(assistant.organizationId),
  ]);
  // What the Flows Agent's turn runs on (ADR-0007): the Organization's
  // connections, or this Member's own subscription once the Owner has allowed
  // those. Whether the Member actually holds one is only known at turn time
  // (it needs the request's host), so the opt-in is the honest floor: with it
  // off and no connection, no turn can succeed and the composer says so.
  const agentProviderReady = providerConnections.length > 0 || personalSubscriptionsAllowed;
  const flow = flowId ? (flows.find((candidate) => candidate.id === flowId) ?? null) : null;
  if (flowId && !flow) notFound();

  // No width wrapper here: the builder's form rendering centres itself, and
  // its canvas rendering is full-bleed (#837).
  return (
    <FlowBuilder
      assistantId={assistantId}
      flow={flow}
      memberId={session.userId}
      canEdit={canEdit(role)}
      assistants={assistants
        .filter((candidate) => candidate.id !== assistantId)
        .map((candidate) => ({ id: candidate.id, title: candidate.title }))}
      helpDesks={helpDesks}
      faqs={faqs}
      connections={connections}
      trust={flow ? (trust.find((entry) => entry.flowId === flow.id) ?? null) : null}
      agentProviderReady={agentProviderReady}
    />
  );
}
