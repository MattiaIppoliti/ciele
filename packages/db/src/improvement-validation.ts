import type { ImprovementValidation } from "@agent-hub/core";
import type { Db } from "./types";

/** The service-role API must enforce the same target ownership as RLS. */
export async function requireValidationTargets(db: Db, organizationId: string, input: Pick<ImprovementValidation, "improvementId" | "assistantId" | "publicationId">): Promise<void> {
  const [improvement, assistant] = await Promise.all([db.getImprovement(input.improvementId), db.getAssistant(input.assistantId)]);
  if (improvement?.organizationId !== organizationId || assistant?.organizationId !== organizationId) throw new Error("Validation targets must belong to the Organization");
  if (input.publicationId && (await db.getLatestPublication(input.assistantId))?.id !== input.publicationId) throw new Error("Published configuration changed before validation was recorded");
}

/** A deployment can precede its additive migration. Do not turn missing storage into false data. */
export function isImprovementWorkflowUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && ["42P01", "PGRST205", "42883", "PGRST202"].includes(String(error.code));
}
