import { raiseImprovement, type Db } from "@agent-hub/db";
import type { ActionEffect } from "./types";
import { sendEmail } from "./email";

/**
 * Applies the deferred effects a turn's Flow Action handlers requested, AFTER
 * the assistant message has been persisted — so `create_improvement` can link
 * to the saved message id and `send_email` only fires on a committed turn.
 * Each effect is isolated: one failing effect never breaks the others or the
 * chat response (the user already has their reply). See ARCHITECTURE.md §5.1.
 */
export async function applyEffects(
  effects: ActionEffect[],
  ctx: { db: Db; organizationId: string; messageId: string | null }
): Promise<void> {
  for (const effect of effects) {
    try {
      switch (effect.kind) {
        case "create_improvement": {
          await raiseImprovement(ctx.db, ctx.organizationId, {
            title: effect.title,
            messageId: ctx.messageId,
          });
          break;
        }
        case "send_email": {
          await sendEmail(effect);
          break;
        }
      }
    } catch (error) {
      console.error(`[effects] ${effect.kind} failed:`, error);
    }
  }
}
