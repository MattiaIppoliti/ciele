import type { Db, Improvement } from "./types";

/**
 * One clamp for every raised Improvement title. The hand-built call sites
 * disagreed (80 / 100 / 120); 120 — the largest in use — wins so no site
 * loses information it kept before.
 */
export const IMPROVEMENT_TITLE_MAX = 120;

/**
 * The one way to raise an Improvement from an AI answer (escalation
 * auto-generate, the `improvement` Flow Action effect, the answer verifier,
 * the compost loop, the Inbox "Improve Answer" action). Owns title
 * normalization/clamping and, for background callers, the policy that a
 * tracker write must never break the primary operation (`swallowErrors`
 * logs and returns null instead of throwing). Site-specific dedup and
 * evidence-linking stay with the callers.
 */
export interface RaiseImprovementInput {
  title: string;
  messageId?: string | null;
  createdBy?: string | null;
}

export async function raiseImprovement(
  db: Db,
  organizationId: string,
  input: RaiseImprovementInput
): Promise<Improvement>;
export async function raiseImprovement(
  db: Db,
  organizationId: string,
  input: RaiseImprovementInput,
  options: { swallowErrors: boolean }
): Promise<Improvement | null>;
export async function raiseImprovement(
  db: Db,
  organizationId: string,
  input: RaiseImprovementInput,
  options: { swallowErrors?: boolean } = {}
): Promise<Improvement | null> {
  try {
    const title = input.title.trim().slice(0, IMPROVEMENT_TITLE_MAX);
    if (!title) throw new Error("Title is required");
    return await db.createImprovement(organizationId, {
      title,
      messageId: input.messageId ?? null,
      createdBy: input.createdBy ?? null,
    });
  } catch (error) {
    if (options.swallowErrors) {
      console.error("[improvements] raise failed:", error);
      return null;
    }
    throw error;
  }
}
