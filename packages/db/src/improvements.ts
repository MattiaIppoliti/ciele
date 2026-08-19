import type { Improvement } from "@agent-hub/core";
import type { Db } from "./types";

/**
 * One clamp for every raised Improvement title. The hand-built call sites
 * disagreed (80 / 100 / 120); 120, the largest in use, wins so no site
 * loses information it kept before.
 */
export const IMPROVEMENT_TITLE_MAX = 120;

/**
 * The one way to raise an Improvement from an AI answer (escalation
 * auto-generate, the `improvement` Flow Action effect, the answer verifier,
 * the compost loop, the Inbox "Improve Answer" action). Owns title
 * normalization/clamping and, for background callers, the policy that a
 * tracker write must never break the primary operation (`swallowErrors`
 * logs and returns null instead of throwing). The conversation-scoped dedup
 * walk lives here too (`raiseOrAttachImprovement` /
 * `findOpenImprovementForConversation`), it used to be re-implemented per
 * caller, and the one caller that skipped it cloned items the verifier had
 * already opened.
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

/**
 * The first still-open Improvement linked to any message of this
 * Conversation, or null. "Open" means not done and not archived, a closed
 * item is a solved problem, and a recurrence deserves a fresh item rather
 * than silently reopening history.
 */
export async function findOpenImprovementForConversation(
  db: Db,
  conversationId: string
): Promise<Improvement | null> {
  const links = await db.listConversationImprovementLinks(conversationId);
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.improvementId)) continue;
    seen.add(link.improvementId);
    const improvement = await db.getImprovement(link.improvementId);
    if (
      improvement &&
      improvement.status !== "done" &&
      improvement.status !== "archived"
    ) {
      return improvement;
    }
  }
  return null;
}

/**
 * Attach-or-raise: the conversation-scoped dedup walk every automatic
 * producer shares. An open Improvement already linked to this Conversation
 * gains the flagged message as an occurrence (same problem, more evidence,
 * never a clone); otherwise a new item is raised. A missing `messageId`
 * (nothing persisted to attach) always raises.
 */
export async function raiseOrAttachImprovement(
  db: Db,
  organizationId: string,
  input: {
    title: string;
    messageId: string | null;
    conversationId: string;
    createdBy?: string | null;
  },
  options: { swallowErrors?: boolean } = {}
): Promise<{ improvement: Improvement; attached: boolean } | null> {
  try {
    if (input.messageId) {
      const open = await findOpenImprovementForConversation(
        db,
        input.conversationId
      );
      if (open) {
        await db.linkImprovementMessage(open.id, input.messageId);
        return { improvement: open, attached: true };
      }
    }
    const improvement = await raiseImprovement(db, organizationId, {
      title: input.title,
      messageId: input.messageId,
      createdBy: input.createdBy,
    });
    return { improvement, attached: false };
  } catch (error) {
    if (options.swallowErrors) {
      console.error("[improvements] raise-or-attach failed:", error);
      return null;
    }
    throw error;
  }
}
