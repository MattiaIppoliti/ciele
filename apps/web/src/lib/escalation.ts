import type { Assistant, FiledTicket, StoredMessage } from "@agent-hub/core";
import {
  DEFAULT_WAIT_TIMEOUT_MINUTES,
  effectiveOperatorState,
  messageText,
  waitExpiresAt,
} from "@agent-hub/core";
import { channelAvailabilityNow } from "./channel-availability";
import { assignWaitingConversations, desksWithAvailableOperator } from "@ciele/ops";
import type { Db } from "@agent-hub/db";
import { raiseImprovement } from "@agent-hub/db";
import { createHash } from "node:crypto";

import {
  enqueueDraftProposalJob,
  sendEmail,
  sendEscalationApiRequest,
  summariseEscalation,
} from "@agent-hub/agent";
import type {
  ApiRequestOutcome,
  EmailTransport,
  EscalationEndpointConfig,
} from "@agent-hub/agent";
import {
  type TicketConfirmation,
  SUMMARY_UNAVAILABLE,
  buildEscalationEmail,
  contactChannelTarget,
  missingRequiredFields,
  visibleFormFields,
} from "./escalation-desks";
import { subjectOwnsConversation, type SubjectRef } from "./widget-db";
import {
  defaultTicketFiler,
  fileTicketChannel,
  type TicketFiler,
} from "./escalation-ticket";

/**
 * The "a Visitor escalates a Conversation" transaction, owned in one place
 * (its widget-safe *menu* projections live next door in escalation-desks.ts).
 * The widget escalation route is a thin adapter over `escalateConversation`;
 * everything decidable, ownership, channel eligibility, form validation,
 * email composition, the escalated flag, the desk's auto-Improvement policy,
 * is decided here, where the mock Db and a fake transport can exercise it.
 */

/** The escalation POST body, exactly as the widget sends it. */
export interface EscalationRequest {
  /** Stable id generated once per form submission and reused across retries. */
  requestId?: string;
  visitorId?: string;
  /**
   * Optional: the always-available escalation button lets a Visitor escalate
   * (and submit a channel form) before ever sending a chat message.
   */
  conversationId?: string;
  helpDeskId?: string;
  /** Present when an email channel's form was submitted. */
  channelId?: string;
  /** The selected contact link, which never submits a ticket or channel form. */
  contactChannelId?: string;
  fields?: Record<string, string>;
}

/**
 * The resolved widget subject (#662), computed by the route from the sealed
 * SSO gate cookie (never from the request body). When absent, ownership
 * falls back to the anonymous-visitor rule over `visitorId`.
 */
export type EscalationSubject = SubjectRef;

/** What happened, for the route to map 1:1 onto HTTP statuses. */
export type EscalationOutcome =
  | { kind: "bad_request" }
  | { kind: "not_found" }
  | { kind: "missing_fields"; missing: string[] }
  /** An API-endpoint channel's request could not run or answered non-2xx. */
  | { kind: "endpoint_failed" }
  /** A ticket channel's record was refused or the system was unreachable (#1088). */
  | { kind: "ticket_failed" }
  | { kind: "ticket_pending" }
  | { kind: "ticket_invalid"; message: string }
  | {
      kind: "ok";
      /**
       * Present when the Visitor chose a Live operator channel (#1083): the
       * Conversation now waits for a person, and the Widget listens for one
       * until `expiresAt`. The id is new when the Visitor had not written yet.
       */
      waiting?: { conversationId: string; expiresAt: string };
      /**
       * Present when a channel form was submitted: whether the escalation
       * email actually left, and, when it did not, the destination address
       * so the widget can offer an honest mailto fallback instead of a fake
       * success confirmation.
       */
      email?: { delivered: boolean; fallbackAddress: string | null };
      /**
       * Present when a ticket channel was submitted (#1088): the number the
       * Visitor can quote, its record link, and the thread it belongs to.
       * Pending submissions never confirm success.
       */
      ticket?: TicketConfirmation;
    };

export async function escalateConversation(input: {
  db: Db;
  /** The live assistant id the route serves (conversation ownership). */
  assistantId: string;
  /** The Publication-snapshot assistant (org ownership, email context). */
  assistant: Pick<Assistant, "organizationId" | "title">;
  request: EscalationRequest;
  /** Gate-resolved subject; defaults to the anonymous visitor (#662). */
  subject?: EscalationSubject;
  /** Injectable so tests observe the composed email; defaults to the runtime transport. */
  transport?: EmailTransport;
  /** Injectable clock for the Live operator wait and its Availability check. */
  now?: Date;
  /**
   * Injectable so tests observe the Chat summary call (#1081); defaults to
   * the runtime's classifier-tier summariser. Resolves null on any failure.
   */
  summarise?: (messages: StoredMessage[]) => Promise<string | null>;
  /** Injectable so tests observe the endpoint call; defaults to the runtime egress. */
  endpointTransport?: (
    config: EscalationEndpointConfig,
    payload: unknown,
    idempotencyKey?: string
  ) => Promise<ApiRequestOutcome>;
  /** Injectable so tests observe the ticket call; defaults to the desk's Connection. */
  ticketFiler?: TicketFiler;
}): Promise<EscalationOutcome> {
  const { db, assistantId, assistant } = input;
  const transport = input.transport ?? sendEmail;
  const summarise =
    input.summarise ??
    ((messages: StoredMessage[]) =>
      summariseEscalation({ db, organizationId: assistant.organizationId, assistantId, messages }));
  const endpointTransport =
    input.endpointTransport ??
    ((config, payload, idempotencyKey) =>
      sendEscalationApiRequest(config, payload, undefined, idempotencyKey));

  const visitorId = (input.request.visitorId ?? "").trim();
  const subject: EscalationSubject =
    input.subject ?? { type: "visitor", id: visitorId };
  const conversationId = (input.request.conversationId ?? "").trim();
  const helpDeskId = (input.request.helpDeskId ?? "").trim();
  const channelId = (input.request.channelId ?? "").trim();
  const requestId = (input.request.requestId ?? "").trim();
  if (!subject.id || !helpDeskId || (!conversationId && !channelId)) {
    return { kind: "bad_request" };
  }

  let conversation = conversationId
    ? await db.getConversation(conversationId)
    : null;
  const now = input.now ?? new Date();
  let waiting: { conversationId: string; expiresAt: string } | undefined;
  if (
    conversationId &&
    !subjectOwnsConversation(conversation, assistantId, subject)
  ) {
    return { kind: "not_found" };
  }
  const desk = await db.getHelpDesk(helpDeskId);
  if (!desk || desk.organizationId !== assistant.organizationId) {
    return { kind: "not_found" };
  }

  // Channel form submission: email channels compose the escalation email
  // through the transport seam; API-endpoint channels POST the payload to
  // the configured endpoint through the egress guard (#315).
  let emailOutcome: { delivered: boolean; fallbackAddress: string | null } | undefined;
  // Which channel the Visitor actually took, recorded on the Conversation so the
  // Inbox rail and the export can say more than "escalated" (#561).
  let escalationOption: string | undefined;
  let escalationChannelId = channelId;
  if (input.request.contactChannelId) {
    if (channelId) return { kind: "bad_request" };
    const contact = (await db.listSupportChannels(desk.id)).find((candidate) => candidate.id === input.request.contactChannelId);
    if (!contact?.enabled || !contactChannelTarget(contact)) return { kind: "not_found" };
    escalationChannelId = contact.id;
    escalationOption = contact.name;
  }
  let ticketOutcome: TicketConfirmation | undefined;
  let filedTicket: FiledTicket | undefined;
  if (channelId) {
    const channel = (await db.listSupportChannels(helpDeskId)).find(
      (c) => c.id === channelId
    );
    const submittable =
      channel?.kind === "email"
        ? Boolean(channel.config.destinationEmail)
        : channel?.kind === "api_endpoint"
          ? Boolean(channel.config.url)
          : channel?.kind === "ticket"
            ? Boolean(desk.ticketingTarget)
            : channel?.kind === "live_operator";
    if (!channel || !channel.enabled || !submittable) {
      return { kind: "not_found" };
    }
    escalationOption = channel.name;
    const values = input.request.fields ?? {};
    // New clients supply a submission id. The hash is a deterministic
    // compatibility fallback for an older client retrying the same form after
    // losing the response; it contains no visitor data itself.
    const operationId = createHash("sha256")
      .update(
        JSON.stringify(
          requestId
            ? [assistantId, subject.type, subject.id, "request", requestId]
            : [
                assistantId,
                subject.type,
                subject.id,
                conversationId,
                helpDeskId,
                channelId,
                Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
              ]
        )
      )
      .digest("hex");
    const idempotencyKey = `escalation/${assistantId}/${operationId}`;
    const missing = missingRequiredFields(channel, values);
    if (missing.length > 0) {
      return { kind: "missing_fields", missing };
    }
    if (channel.kind === "ticket" && !conversation) {
      // The support button is available before the first chat message. The
      // stable submission id lets concurrent retries reuse one Inbox thread.
      conversation = await db.createConversation({
        id: `ticket-${operationId}`,
        assistantId,
        subjectType: subject.type,
        subjectId: subject.id,
        title: `Ticket: ${desk.name}`,
      });
      if (!subjectOwnsConversation(conversation, assistantId, subject)) return { kind: "not_found" };
    }
    let transcript: string | undefined;
    // The Chat summary (#1081): only for the channels that carry Conversation
    // Data, only when asked, and only once there is something to summarise.
    // A retry of the same escalation reuses the stored text.
    let summary: string | null | undefined;
    const wantsSummary =
      channel.conversationData.chatSummary === true &&
      (channel.kind === "email" || channel.kind === "api_endpoint" || channel.kind === "ticket") &&
      conversation !== null;
    const transcriptMessages =
      conversation && (wantsSummary || channel.conversationData.fullChatHistory)
        ? await db.listMessages(conversation.id)
        : [];
    if (wantsSummary && transcriptMessages.some((m) => m.role === "user")) {
      const stored = conversation!.metadata;
      if (stored.escalationSummary && stored.escalationSummaryKey === operationId) {
        summary = stored.escalationSummary;
      } else {
        summary = await summarise(transcriptMessages).catch(() => null);
        if (summary) {
          await db
            .updateConversationMetadata(conversation!.id, {
              escalationSummary: summary,
              escalationSummaryKey: operationId,
            })
            .catch(() => {});
        }
      }
    }
    if (channel.conversationData.fullChatHistory && conversation) {
      const messages = transcriptMessages;
      transcript = messages
        .map((m) => {
          const text = messageText(m.content ?? [], " ");
          return text
            ? `${m.role === "user" ? "User" : m.role === "operator" ? `Operator${m.authorName ? ` (${m.authorName})` : ""}` : m.role === "system" ? "System" : "Assistant"}: ${text}`
            : null;
        })
        .filter(Boolean)
        .join("\n");
    }
    if (channel.kind === "live_operator") {
      // Outside its Availability the channel is not offered (#1083), the
      // same rule as every other channel; the Widget hides it, this refuses
      // a stale menu.
      const schedules = channel.availability.mode === "business_hours" ? await db.table("businessHours").list({ organizationId: assistant.organizationId }) : [];
      if (!channelAvailabilityNow(channel.availability, now, schedules).available) {
        return { kind: "not_found" };
      }
      // Never a queue nobody watches (#1084): some operator of this desk
      // must be Available.
      if (!(await desksWithAvailableOperator(db, assistant.organizationId)).has(desk.id)) {
        return { kind: "not_found" };
      }
      // A retried request, or a second click, must not restart a wait that
      // is still on: its expiry is derived from when it started.
      if (conversation && effectiveOperatorState(conversation.operator, now) !== "ai") {
        if (conversation.operator?.state === "held") return { kind: "not_found" };
        return {
          kind: "ok",
          waiting: {
            conversationId: conversation.id,
            expiresAt: waitExpiresAt(conversation.operator)!.toISOString(),
          },
        };
      }
      // A Visitor may ask for a person before writing anything; the wait
      // needs a Conversation to hold their messages.
      conversation ??= await db.createConversation({
        assistantId,
        subjectType: subject.type,
        subjectId: subject.id,
        title: "Talk to a person",
      });
      const started = await db.startConversationWait({
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: channel.id,
        timeoutMinutes: channel.config.waitTimeoutMinutes ?? DEFAULT_WAIT_TIMEOUT_MINUTES,
        now: now.toISOString(),
      });
      // Already held: a person is answering, so there is nothing to wait for.
      if (!started) return { kind: "not_found" };
      conversation = started;
      // Hand it to the least-loaded Available operator of the desk (#1084);
      // when nobody is free it stays in the shared Waiting view.
      await assignWaitingConversations(db, assistant.organizationId, now).catch(() => []);
      waiting = {
        conversationId: started.id,
        expiresAt: waitExpiresAt(started.operator)!.toISOString(),
      };
      const fields = visibleFormFields(channel)
        .map((field) => ({ label: field.label, value: (values[field.id] ?? "").trim() }))
        .filter((field) => field.value);
      if (fields.length > 0) {
        await db.updateConversationMetadata(started.id, { operatorRequestFields: fields });
      }
    } else if (channel.kind === "email") {
      const delivery = await transport(
        buildEscalationEmail(channel, values, {
          assistantTitle: assistant.title,
          deskName: desk.name,
          transcript,
          ...(summary !== undefined ? { summary } : {}),
        }),
        { idempotencyKey }
      );
      emailOutcome = {
        delivered: delivery.delivered,
        fallbackAddress: delivery.delivered
          ? null
          : (channel.config.destinationEmail ?? null),
      };
    } else if (channel.kind === "ticket" && desk.ticketingTarget) {
      if (!conversation) return { kind: "bad_request" };
      const filed = await fileTicketChannel({
        db,
        organizationId: assistant.organizationId,
        desk: { ...desk, ticketingTarget: desk.ticketingTarget },
        channel,
        conversationId: conversation.id,
        idempotencyKey,
        values,
        assistantTitle: assistant.title,
        transcript,
        summary,
        filer: input.ticketFiler ?? defaultTicketFiler(db, assistant.organizationId),
      });
      // A pending or unconfirmed write cannot mark the Conversation escalated.
      if (filed.kind === "invalid") return { kind: "ticket_invalid", message: filed.message };
      if (filed.kind === "failed") return { kind: "ticket_failed" };
      if (filed.kind === "in_progress") return { kind: "ticket_pending" };
      filedTicket = filed.ticket;
      ticketOutcome = { number: filed.ticket.number, url: filed.ticket.url, conversationId: conversation.id };
    } else {
      const fields = visibleFormFields(channel).map((field) => ({
        id: field.id,
        label: field.label,
        value: values[field.id] ?? "",
      }));
      const outcome = await endpointTransport(
        channel.config,
        {
          assistant: assistant.title,
          helpDesk: desk.name,
          channel: channel.name,
          conversationId: conversation?.id ?? null,
          ...(summary !== undefined
            ? { summary, ...(summary ? {} : { summaryNote: SUMMARY_UNAVAILABLE }) }
            : {}),
          fields,
          ...(transcript ? { transcript } : {}),
        },
        idempotencyKey
      );
      // Honest failure: an unreachable/erroring endpoint must not read as a
      // submitted escalation (the conversation is not flagged either).
      if (!outcome.ok) return { kind: "endpoint_failed" };
    }
  }

  const alreadyEscalated = conversation?.metadata?.escalated === true;
  if (conversation) {
    // The desk the pre-flight had opened the chip on (#955), compared against
    // the one the Visitor took. Recorded only when a recommendation existed:
    // "not followed" must never be inferred from a turn that recommended nothing.
    const recommendedId = conversation.metadata?.preflight?.recommendedHelpDeskId;
    let recommended: { name: string } | null = null;
    if (recommendedId === desk.id) recommended = desk;
    else if (recommendedId) recommended = await db.getHelpDesk(recommendedId).catch(() => null);
    await db.updateConversationMetadata(conversation.id, {
      escalated: true,
      escalationHelpDesk: desk.name,
      escalationHelpDeskId: desk.id,
      ...(escalationChannelId ? { escalationChannelId } : {}),
      escalationInboxUrl: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://ciele.app"}/inbox?conversation=${encodeURIComponent(conversation.id)}`,
      ...(escalationOption ? { escalationOption } : {}),
      ...(filedTicket ? { escalationTicket: filedTicket } : {}),
      ...(recommendedId
        ? {
            escalationRecommendedHelpDesk: recommended?.name ?? recommendedId,
            escalationFollowedRecommendation: recommendedId === desk.id,
          }
        : {}),
    });
  }

  // Help-desk "Answer Improvements": flag the last AI answer for review.
  // Only on the first escalation of a conversation, so repeated channel
  // clicks don't flood the tracker; a tracker failure never fails the Visitor.
  if (conversation && desk.autoGenerateImprovements && !alreadyEscalated) {
    const messages = await db.listMessages(conversation.id);
    const lastAssistant = messages.findLast((m) => m.role === "assistant");
    const lastUser = messages.findLast((m) => m.role === "user");
    const userText = messageText(lastUser?.content ?? [], " ");
    const raised = await raiseImprovement(
      db,
      assistant.organizationId,
      {
        source: "escalation",
        assistantId,
        title: `Escalated: ${userText || conversation.title || "conversation"}`,
        messageId: lastAssistant?.id ?? null,
      },
      { swallowErrors: true }
    );
    if (lastAssistant?.id && raised) {
      // Draft a Suggested Fix for the flagged answer (#390).
      await enqueueDraftProposalJob(
        { improvementId: raised.id, messageId: lastAssistant.id },
        { db }
      );
    }
  }

  return {
    kind: "ok",
    email: emailOutcome,
    ...(waiting ? { waiting } : {}),
    ...(ticketOutcome ? { ticket: ticketOutcome } : {}),
  };
}
