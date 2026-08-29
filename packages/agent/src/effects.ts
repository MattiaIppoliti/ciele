import { raiseOrAttachImprovement, type Db } from "@agent-hub/db";
import type { ActionEffect } from "./types";
import { sendEmail } from "./email";

async function applyEffect(
  effect: ActionEffect,
  ctx: {
    db: Db;
    organizationId: string;
    conversationId: string;
    messageId: string | null;
  },
  idempotencyKey?: string
): Promise<void> {
  switch (effect.kind) {
    case "create_improvement":
      await raiseOrAttachImprovement(ctx.db, ctx.organizationId, {
        title: effect.title,
        messageId: ctx.messageId,
        conversationId: ctx.conversationId,
      });
      return;
    case "send_email": {
      const delivery = await sendEmail(effect, { idempotencyKey });
      if (!delivery.delivered) throw new Error(`Email ${delivery.reason}`);
    }
  }
}

/**
 * Applies the deferred effects a turn's Flow Action handlers requested, AFTER
 * the assistant message has been persisted, so `create_improvement` can link
 * to the saved message id and `send_email` only fires on a committed turn.
 * Each effect is isolated: one failing effect never breaks the others or the
 * chat response (the user already has their reply). See ARCHITECTURE.md §5.1.
 */
export async function applyEffects(
  effects: ActionEffect[],
  ctx: {
    db: Db;
    organizationId: string;
    conversationId: string;
    messageId: string | null;
  }
): Promise<void> {
  for (const effect of effects) {
    try {
      await applyEffect(effect, ctx);
    } catch (error) {
      console.error(`[effects] ${effect.kind} failed:`, error);
    }
  }
}

function storedActionEffect(value: unknown): ActionEffect {
  const effect = value as Partial<ActionEffect> | null;
  if (effect?.kind === "create_improvement" && typeof effect.title === "string") {
    return { kind: effect.kind, title: effect.title };
  }
  if (
    effect?.kind === "send_email" &&
    typeof effect.to === "string" &&
    typeof effect.subject === "string" &&
    typeof effect.body === "string"
  ) {
    return {
      kind: effect.kind,
      to: effect.to,
      subject: effect.subject,
      body: effect.body,
      ...(typeof effect.replyTo === "string" ? { replyTo: effect.replyTo } : {}),
    };
  }
  throw new Error("Invalid deferred turn effect payload");
}

/** Claims and delivers a bounded outbox window, optionally for one message. */
export async function drainTurnEffects(
  db: Db,
  options: { messageId?: string; limit?: number; now?: Date } = {}
): Promise<{ claimed: number; succeeded: number; failed: number; superseded: number }> {
  const now = options.now ?? new Date();
  const effects = await db.claimTurnEffects({
    messageId: options.messageId,
    workerId: `turn-effects-${crypto.randomUUID()}`,
    now: now.toISOString(),
    staleBefore: new Date(now.getTime() - 10 * 60_000).toISOString(),
    limit: options.limit ?? 25,
  });
  const report = { claimed: effects.length, succeeded: 0, failed: 0, superseded: 0 };
  for (const row of effects) {
    try {
      await applyEffect(
        storedActionEffect(row.payload),
        {
          db,
          organizationId: row.organizationId,
          conversationId: row.conversationId,
          messageId: row.messageId,
        },
        `turn-effect/${row.id}`
      );
      const settled = await db.settleTurnEffect({
        id: row.id,
        leaseToken: row.leaseToken,
        now: new Date().toISOString(),
        succeeded: true,
      });
      report[settled ? "succeeded" : "superseded"] += 1;
    } catch (error) {
      const settled = await db.settleTurnEffect({
        id: row.id,
        leaseToken: row.leaseToken,
        now: new Date().toISOString(),
        succeeded: false,
        error: error instanceof Error ? error.message : "Effect failed",
      });
      report[settled ? "failed" : "superseded"] += 1;
    }
  }
  return report;
}
