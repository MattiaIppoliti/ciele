import type { Assistant } from "@agent-hub/core";
import { redactFlowsSecrets } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ConnectorConnectionOption } from "@/lib/connector-options";

/**
 * What the Flow Builder can point at, read once for both the page that renders
 * it and the Flows Agent route that grounds a turn in it (#837, #838). One
 * loader so the two cannot disagree about which Help Desks are selectable,
 * which Concepts count as FAQs, or whose Application Connections a Member may
 * see.
 *
 * Connections follow #840: the Organization's plus this Member's own personal
 * ones and nobody else's, never the sealed credential. Flows come back redacted.
 */
export interface FlowBuilderCatalogue {
  flows: Awaited<ReturnType<Db["listFlows"]>>;
  helpDesks: { id: string; name: string }[];
  faqs: { id: string; question: string }[];
  connections: ConnectorConnectionOption[];
  collections: { id: string; name: string }[];
}

export async function loadFlowBuilderCatalogue(
  db: Db,
  assistant: Assistant,
  memberId: string
): Promise<FlowBuilderCatalogue> {
  const [flows, helpDesks, collections, applicationConnections, faqs] = await Promise.all([
    db.listFlows(assistant.id).then(redactFlowsSecrets),
    db.listHelpDesks(assistant.organizationId),
    db.listCollections(assistant.id),
    db.listApplicationConnections(assistant.organizationId),
    db.listAssistantFaqOptions(assistant.id),
  ]);
  const selected = assistant.helpDeskSettings.selectedIds ?? [];
  return {
    flows,
    helpDesks: helpDesks
      .filter((helpDesk) => selected.includes(helpDesk.id))
      .map((helpDesk) => ({ id: helpDesk.id, name: helpDesk.name })),
    faqs,
    connections: applicationConnections
      .filter(
        (connection) =>
          connection.ownerType === "organization" || connection.ownerMemberId === memberId
      )
      .map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        status: connection.status,
        scopes: connection.scopes,
        ownerType: connection.ownerType,
      })),
    collections: collections.map((collection) => ({ id: collection.id, name: collection.name })),
  };
}
