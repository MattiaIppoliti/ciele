import type { TeammateActionOutcome } from "@agent-hub/agent";
import type { MutatedEntity } from "@ciele/ops";
import { revalidateEntities } from "@/lib/org-mutation";

/**
 * What a Teammate or Ciele AI tool hands back once its operation has landed:
 * the pages it touched revalidated, and the entities named for the card.
 *
 * The revalidation is best-effort. A turn is a streamed Route Handler, so the
 * request store `revalidatePath` needs may already be gone by the time a tool
 * runs, and the mutation has landed either way: the cost of failing here is a
 * page that is one refresh stale, which is not worth losing the turn over.
 */
export function settleToolOutcome(
  outcome: { entities: MutatedEntity[]; result: unknown },
  organizationId: string
): Pick<TeammateActionOutcome, "entities" | "result"> {
  try {
    revalidateEntities(outcome.entities, organizationId);
  } catch {
    // Ignored on purpose, see above.
  }
  return {
    // `id` is whichever identifier the kind carries, so an assistant-scoped
    // entity still names something a reader can look up.
    entities: outcome.entities.map((entity) => ({
      kind: entity.kind,
      id: "id" in entity ? entity.id : "assistantId" in entity ? entity.assistantId : undefined,
    })),
    result: outcome.result,
  };
}
