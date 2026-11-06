import type { EscalationTicket, FiledTicket, HelpDesk, SupportChannel, TicketDraft, TicketingTarget } from "@agent-hub/core";
import { ticketFromForm } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { dbConnectorRuntime, fileTicket, type TicketFilingOutcome } from "@agent-hub/agent";
import { TICKETING_PLATFORMS } from "./ticketing-integrations";

/**
 * The "Create a ticket" step of an escalation (#1088, #1089), kept beside the
 * transaction rather than inside it: claim the submission, file it through
 * the desk's ticketing target, settle the claim, and raise or clear the
 * Alert. `escalateConversation` decides when this runs and what the Visitor
 * is told; this decides whether a record exists.
 */

export type TicketFiler = (
  target: TicketingTarget,
  draft: TicketDraft
) => Promise<TicketFilingOutcome>;

/** The Alert `sourceKey` for one ticketing Connection, shared by the raise and the clear. */
export function ticketingAlertKey(connectionId: string): string {
  return `ticketing-target:${connectionId}`;
}

/** The runtime filer: the catalogued action over the Organization's Connection. */
export function defaultTicketFiler(db: Db, organizationId: string): TicketFiler {
  // Never `allowPersonal`: a published widget files under the Organization.
  const runtime = dbConnectorRuntime(db, organizationId);
  return (target, draft) => fileTicket(target, draft, runtime);
}

export type TicketChannelOutcome =
  /** Filed now, or by an earlier attempt with the same request id. */
  | { kind: "filed"; ticket: FiledTicket }
  /** Another attempt with the same request id is filing it right now. */
  | { kind: "in_progress" }
  | { kind: "failed" }
  | { kind: "invalid"; message: string };

export async function fileTicketChannel(input: {
  db: Db;
  organizationId: string;
  desk: HelpDesk & { ticketingTarget: TicketingTarget };
  channel: SupportChannel;
  conversationId: string;
  idempotencyKey: string;
  values: Record<string, string>;
  assistantTitle: string;
  transcript?: string;
  /** The Chat summary (#1081), when the channel asks for it and one exists. */
  summary?: string | null;
  filer: TicketFiler;
}): Promise<TicketChannelOutcome> {
  const { db, organizationId, desk, channel } = input;
  const target = desk.ticketingTarget;
  const savedOutcome = (ticket: EscalationTicket): TicketChannelOutcome => {
    // A request id cannot attach an earlier ticket to a different thread or channel.
    if (ticket.organizationId !== organizationId || ticket.conversationId !== input.conversationId || ticket.helpDeskId !== desk.id || ticket.channelId !== channel.id) {
      return { kind: "failed" };
    }
    return ticket.status === "filed" && ticket.ticket
      ? { kind: "filed", ticket: ticket.ticket }
      : ticket.status === "failed"
        ? { kind: "failed" }
        : { kind: "in_progress" };
  };
  // The transcript may have grown since filing. A replay returns its saved
  // outcome before validating content that will never be sent to the provider.
  const saved = await db.getEscalationTicket(organizationId, input.idempotencyKey);
  if (saved) return savedOutcome(saved);
  let draft: TicketDraft;
  try {
    draft = ticketFromForm(channel.form, input.values, {
      assistantTitle: input.assistantTitle,
      deskName: desk.name,
      channelName: channel.name,
      summary: input.summary,
      transcript: input.transcript,
    });
  } catch (error) {
    if (error instanceof RangeError) return { kind: "invalid", message: error.message };
    throw error;
  }
  const claim = await db.claimEscalationTicket({
    organizationId,
    idempotencyKey: input.idempotencyKey,
    helpDeskId: desk.id,
    channelId: channel.id,
    conversationId: input.conversationId,
    provider: target.provider,
  });
  // Another request may claim the key between the read and the insert.
  if (!claim.claimed) return savedOutcome(claim.ticket);

  const outcome = await input.filer(target, draft).catch(
    (error: unknown): TicketFilingOutcome => ({
      ok: false,
      error: {
        provider: target.provider,
        code: "network",
        message: error instanceof Error ? error.message : "The ticket could not be filed",
        status: null,
      },
    })
  );
  const label = TICKETING_PLATFORMS[target.provider].label;

  if (!outcome.ok) {
    await db.settleEscalationTicket(claim.ticket.id, {
      status: "failed",
      error: outcome.error.message,
    });
    const connection = await db.getApplicationConnection(target.connectionId).catch(() => null);
    const connectionName = connection?.name ?? target.connectionId;
    await db.raiseAlert(organizationId, {
      type: "integration",
      title: `Tickets are not reaching ${label}`,
      detail: `The help desk "${desk.name}" could not file a ticket through the ${label} connection "${connectionName}": ${outcome.error.message}. The Visitor was told the ticket could not be confirmed and was offered the desk's other channels. This alert clears on the next ticket that files.`,
      sourceKey: ticketingAlertKey(target.connectionId),
    });
    return { kind: "failed" };
  }

  await db.settleEscalationTicket(claim.ticket.id, { status: "filed", ticket: outcome.ticket });
  await db.resolveAlertsByKey(organizationId, ticketingAlertKey(target.connectionId));
  return { kind: "filed", ticket: outcome.ticket };
}
