import type { Assistant } from "@agent-hub/core";
import { messageText } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { raiseImprovement } from "@agent-hub/db";

import {
  enqueueDraftProposalJob,
  feedbackScore,
  forwardGraphFeedback,
  sendEmail,
  sendEscalationApiRequest,
} from "@agent-hub/agent";
import type {
  ApiRequestOutcome,
  EmailTransport,
  EscalationEndpointConfig,
} from "@agent-hub/agent";
import {
  buildEscalationEmail,
  missingRequiredFields,
  visibleFormFields,
} from "./escalation-desks";
import { subjectOwnsConversation, type SubjectRef } from "./widget-db";

/**
 * The "a Visitor escalates a Conversation" transaction, owned in one place
 * (its widget-safe *menu* projections live next door in escalation-desks.ts).
 * The widget escalation route is a thin adapter over `escalateConversation`;
 * everything decidable — ownership, channel eligibility, form validation,
 * email composition, the escalated flag, the desk's auto-Improvement policy —
 * is decided here, where the mock Db and a fake transport can exercise it.
 */

/** The escalation POST body, exactly as the widget sends it. */
export interface EscalationRequest {
  visitorId?: string;
  /**
   * Optional: the always-available escalation button lets a Visitor escalate
   * (and submit a channel form) before ever sending a chat message.
   */
  conversationId?: string;
  helpDeskId?: string;
  /** Present when an email channel's form was submitted. */
  channelId?: string;
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
  | {
      kind: "ok";
      /**
       * Present when a channel form was submitted: whether the escalation
       * email actually left, and — when it did not — the destination address
       * so the widget can offer an honest mailto fallback instead of a fake
       * success confirmation.
       */
      email?: { delivered: boolean; fallbackAddress: string | null };
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
  /** Injectable so tests observe the endpoint call; defaults to the runtime egress. */
  endpointTransport?: (
    config: EscalationEndpointConfig,
    payload: unknown
  ) => Promise<ApiRequestOutcome>;
}): Promise<EscalationOutcome> {
  const { db, assistantId, assistant } = input;
  const transport = input.transport ?? sendEmail;
  const endpointTransport =
    input.endpointTransport ?? sendEscalationApiRequest;

  const visitorId = (input.request.visitorId ?? "").trim();
  const subject: EscalationSubject =
    input.subject ?? { type: "visitor", id: visitorId };
  const conversationId = (input.request.conversationId ?? "").trim();
  const helpDeskId = (input.request.helpDeskId ?? "").trim();
  const channelId = (input.request.channelId ?? "").trim();
  if (!subject.id || !helpDeskId || (!conversationId && !channelId)) {
    return { kind: "bad_request" };
  }

  const conversation = conversationId
    ? await db.getConversation(conversationId)
    : null;
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
  if (channelId) {
    const channel = (await db.listSupportChannels(helpDeskId)).find(
      (c) => c.id === channelId
    );
    const submittable =
      channel?.kind === "email"
        ? Boolean(channel.config.destinationEmail)
        : channel?.kind === "api_endpoint"
          ? Boolean(channel.config.url)
          : false;
    if (!channel || !channel.enabled || !submittable) {
      return { kind: "not_found" };
    }
    escalationOption = channel.name;
    const values = input.request.fields ?? {};
    const missing = missingRequiredFields(channel, values);
    if (missing.length > 0) {
      return { kind: "missing_fields", missing };
    }
    let transcript: string | undefined;
    if (channel.conversationData.fullChatHistory && conversation) {
      const messages = await db.listMessages(conversation.id);
      transcript = messages
        .map((m) => {
          const text = messageText(m.content ?? [], " ");
          return text
            ? `${m.role === "user" ? "User" : "Assistant"}: ${text}`
            : null;
        })
        .filter(Boolean)
        .join("\n");
    }
    if (channel.kind === "email") {
      const delivery = await transport(
        buildEscalationEmail(channel, values, {
          assistantTitle: assistant.title,
          deskName: desk.name,
          transcript,
        })
      );
      emailOutcome = {
        delivered: delivery.delivered,
        fallbackAddress: delivery.delivered
          ? null
          : (channel.config.destinationEmail ?? null),
      };
    } else {
      const fields = visibleFormFields(channel).map((field) => ({
        id: field.id,
        label: field.label,
        value: values[field.id] ?? "",
      }));
      const outcome = await endpointTransport(channel.config, {
        assistant: assistant.title,
        helpDesk: desk.name,
        channel: channel.name,
        conversationId: conversation?.id ?? null,
        fields,
        ...(transcript ? { transcript } : {}),
      });
      // Honest failure: an unreachable/erroring endpoint must not read as a
      // submitted escalation (the conversation is not flagged either).
      if (!outcome.ok) return { kind: "endpoint_failed" };
    }
  }

  const alreadyEscalated = conversation?.metadata?.escalated === true;
  if (conversation) {
    await db.updateConversationMetadata(conversation.id, {
      escalated: true,
      escalationHelpDesk: desk.name,
      ...(escalationOption ? { escalationOption } : {}),
    });
  }

  // Help-desk "Answer Improvements": flag the last AI answer for review.
  // Only on the first escalation of a conversation, so repeated channel
  // clicks don't flood the tracker; a tracker failure never fails the Visitor.
  if (conversation && desk.autoGenerateImprovements && !alreadyEscalated) {
    const messages = await db.listMessages(conversation.id);
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = messageText(lastUser?.content ?? [], " ");
    const raised = await raiseImprovement(
      db,
      assistant.organizationId,
      {
        title: `Escalated: ${userText || conversation.title || "conversation"}`,
        messageId: lastAssistant?.id ?? null,
      },
      { swallowErrors: true }
    );
    if (lastAssistant?.id) {
      // An escalation is an implicit thumbs-down on the last answer: if it was
      // graph-served, score it 1 so the learning loop demotes its material (#389).
      await forwardGraphFeedback({
        db,
        organizationId: assistant.organizationId,
        messageId: lastAssistant.id,
        score: feedbackScore(-1),
        text: "Escalated to human support without a resolving answer.",
      });
      // Draft a Suggested Fix for the flagged answer (#390).
      if (raised) {
        await enqueueDraftProposalJob(
          { improvementId: raised.id, messageId: lastAssistant.id },
          { db }
        );
      }
    }
  }

  return { kind: "ok", email: emailOutcome };
}
