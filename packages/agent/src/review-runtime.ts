import type {
  ApplicationConnection,
  Assistant,
  Conversation,
  ReviewRequest,
} from "@agent-hub/core";
import {
  expireReview,
  reviewHaltMessage,
  reviewRequestText,
  sealSecret,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ApplicationCredentials } from "./application-connectors";
import {
  ApplicationAuthorizationError,
  applicationCredentials,
  defaultApplicationHttpClient,
  refreshApplicationCredentials,
  trustedUrl,
  type ApplicationHttpClient,
} from "./application-provider-http";
import { connectorAlertKey } from "./connector-request";
import { resumeGateTurn } from "./resume-gate-turn";
import { gateTokens } from "./gate-token";
import { getRuntimeHost } from "./host";
import { nonRetryable } from "./job-errors";
import type { JobHandler } from "./jobs";
import { platformAppOrigin } from "./template";
import type { ChatReplyPart, ReviewRuntime } from "./types";

/**
 * The Human review gate's runtime (spec #836, #841): what happens after the
 * action stopped the turn.
 *
 * Three pieces, each a pure function of the row plus a Db:
 *
 * - {@link dbReviewRuntime}, the port the `human_review` action calls to raise a
 *   request: inserts the row, marks the Conversation as waiting, and queues
 *   delivery (never on a simulated Preview / Teammate turn).
 * - The two durable job kinds (ADR-0008). `deliver_review_request` sends the
 *   request from the Editor's own mailbox (Microsoft Graph) or through the
 *   Organization's Slack bot, carrying a **signed link** to the decision page.
 *   `resume_reviewed_conversation` continues the Flow after approval (a
 *   system-initiated Conversation Turn from the stored cursor) or persists the
 *   halt message after a rejection or expiry.
 * - {@link expireDueReviews}, the clock: pending and overdue → expired, then
 *   the same resumption job, halt path.
 *
 * Replying to the email or the Slack message is not parsed. The link is the
 * one way back, and it opens a console page where the Member must be signed
 * in, so the decision is always attributed to an account, never to a mailbox.
 */

export const DELIVER_REVIEW_KIND = "deliver_review_request" as const;
export const RESUME_REVIEW_KIND = "resume_reviewed_conversation" as const;

// ---------------------------------------------------------------------------
// The port the action calls.
// ---------------------------------------------------------------------------

/**
 * The action's port. Simulated when the turn runs on an operator surface (the
 * Preview): the row exists so the same decide path runs, but nobody is emailed
 * and the transcript decides inline. Bound to the turn's **system** Db: the
 * table has no member insert policy, the runtime is the only writer.
 */
export function dbReviewRuntime(
  db: Db,
  args: {
    conversation: Pick<Conversation, "id" | "metadata">;
    assistant: Pick<Assistant, "id" | "organizationId">;
    simulated: boolean;
  }
): ReviewRuntime {
  return {
    simulated: args.simulated,
    conversationId: args.conversation.id,
    async create(input) {
      const review = await db.table("reviewRequests").insert({
        ...input,
        organizationId: args.assistant.organizationId,
        assistantId: args.assistant.id,
        conversationId: args.conversation.id,
        simulated: args.simulated,
      });
      await db.updateConversationMetadata(args.conversation.id, {
        ...args.conversation.metadata,
        pendingReviewId: review.id,
      });
      if (!args.simulated) {
        await enqueueReviewJob(db, DELIVER_REVIEW_KIND, review, 5);
      }
      return review;
    },
  };
}

// ---------------------------------------------------------------------------
// Signed links.
// ---------------------------------------------------------------------------

/**
 * A link stays valid a week past the request's expiry, so the assignee who
 * opens it late reads "expired" on the page rather than "bad link".
 */
const reviewTokens = gateTokens("review-link-v1", 7 * 24 * 3_600_000);

/**
 * The token a request's link carries: the review id and the request's own
 * expiry, signed. The expiry is inside the signed material, so a forwarded link
 * cannot outlive the request it names.
 */
export function mintReviewLinkToken(review: Pick<ReviewRequest, "id" | "expiresAt">): string {
  return reviewTokens.mint(review);
}

export type ReviewLinkVerdict =
  | { ok: true; reviewId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unconfigured" };

export function verifyReviewLinkToken(
  token: string,
  options: { now?: Date; graceMs?: number } = {}
): ReviewLinkVerdict {
  const verdict = reviewTokens.verify(token, options);
  return verdict.ok ? { ok: true, reviewId: verdict.id } : verdict;
}

export function reviewLinkUrl(review: Pick<ReviewRequest, "id" | "expiresAt">): string {
  return `${platformAppOrigin()}/reviews/${encodeURIComponent(review.id)}?t=${mintReviewLinkToken(review)}`;
}

// ---------------------------------------------------------------------------
// Delivery.
// ---------------------------------------------------------------------------

export interface ReviewJobDeps {
  db: Db;
  client?: ApplicationHttpClient;
  now?: () => Date;
}

const GRAPH_HOSTS = ["graph.microsoft.com"];
const SLACK_HOSTS = ["slack.com"];

async function openCredentials(
  db: Db,
  connection: ApplicationConnection,
  client: ApplicationHttpClient
): Promise<ApplicationCredentials> {
  const stored = applicationCredentials(connection);
  const { active, refreshed } = await refreshApplicationCredentials(
    connection.provider,
    stored,
    client
  );
  if (refreshed) {
    await db.updateApplicationConnection(connection.id, {
      sealedCredentials: sealSecret(JSON.stringify(refreshed)),
    });
  }
  return active;
}

async function markConnectionBroken(
  db: Db,
  connection: ApplicationConnection,
  message: string
): Promise<void> {
  await db.updateApplicationConnection(connection.id, {
    status: "reauthorization_required",
    error: message,
  });
  await db.raiseAlert(connection.organizationId, {
    type: "integration",
    title: `${connection.name} needs to be reconnected`,
    detail: `A Human review request could not be sent through the ${connection.provider} connection "${connection.name}": ${message}. Reconnect it; requests using it will fail until then.`,
    // The same key the Connector runtime uses, so the OAuth callback that
    // clears one clears this one too.
    sourceKey: connectorAlertKey(connection.id),
  });
}

/**
 * Send one request on its channel. Throws (retryable) on transport trouble and
 * marks the Connection broken (non-retryable) on an authorization failure: a
 * revoked token does not fix itself on the next attempt.
 */
export async function deliverReviewRequest(
  review: ReviewRequest,
  settings: { senderConnectionId?: string; slackTarget?: string },
  deps: ReviewJobDeps
): Promise<void> {
  const { db } = deps;
  const client = deps.client ?? defaultApplicationHttpClient;
  const assistant = await db.getAssistant(review.assistantId);
  const text = reviewRequestText({
    title: review.title,
    message: review.message,
    summary: review.summary,
    assistantTitle: assistant?.title ?? "Your assistant",
    link: reviewLinkUrl(review),
    expiresAt: review.expiresAt,
  });

  const connectionId = settings.senderConnectionId;
  if (review.channel === "email") {
    if (!connectionId) throw nonRetryable("The review has no sender mailbox connected");
    const connection = await db.getApplicationConnection(connectionId);
    if (!connection || connection.organizationId !== review.organizationId) {
      throw nonRetryable("The sender mailbox connection no longer exists");
    }
    if (connection.provider !== "microsoft_mail") {
      throw nonRetryable("The sender connection is not a Microsoft 365 mailbox");
    }
    try {
      const credentials = await openCredentials(db, connection, client);
      const response = await client(trustedUrl("https://graph.microsoft.com/v1.0/me/sendMail", GRAPH_HOSTS), {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: text.subject,
            body: { contentType: "Text", content: text.body },
            toRecipients: review.assignees.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: true,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        throw new ApplicationAuthorizationError();
      }
      if (!response.ok) throw new Error(`Microsoft Graph returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof ApplicationAuthorizationError) {
        await markConnectionBroken(db, connection, error.message || "authorization was refused");
        throw nonRetryable(`Mailbox authorization failed: ${error.message}`);
      }
      throw error;
    }
    return;
  }

  // Slack: the Organization's bot posts to the configured channel or person.
  const target = settings.slackTarget?.trim();
  if (!target) throw nonRetryable("The review has no Slack channel or person configured");
  // The Organization's Slack bot. A sender id left over from an email
  // configuration is ignored rather than trusted: only a connected, org-owned
  // Slack row may post.
  // The list read is the safe one (no credential); the row is re-read by id
  // for the token it needs to post.
  // `chat:write` is checked here and not only at Publish: a Connection
  // re-consented to fewer scopes after Publish would otherwise post and fail,
  // and the reason belongs in the job's own error, not in Slack's.
  const candidate = (await db.listApplicationConnections(review.organizationId)).find(
    (connection) =>
      connection.provider === "slack" &&
      connection.ownerType === "organization" &&
      connection.status === "connected" &&
      connection.scopes.includes("chat:write")
  );
  const slack = candidate ? await db.getApplicationConnection(candidate.id) : null;
  if (!slack) {
    throw nonRetryable(
      "No Slack connection with the chat:write scope is available to post the request"
    );
  }
  try {
    const credentials = await openCredentials(db, slack, client);
    const response = await client(trustedUrl("https://slack.com/api/chat.postMessage", SLACK_HOSTS), {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channel: target,
        text: `*${text.subject}*\n${text.body}`,
      }),
    });
    if (response.status === 401 || response.status === 403) throw new ApplicationAuthorizationError();
    if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}`);
    let parsed: { ok?: boolean; error?: string } = {};
    try {
      parsed = JSON.parse(response.text) as { ok?: boolean; error?: string };
    } catch {
      /* Slack always answers JSON; a non-JSON body is a transport problem. */
    }
    if (parsed.ok === false) {
      if (parsed.error === "invalid_auth" || parsed.error === "token_revoked" || parsed.error === "missing_scope") {
        throw new ApplicationAuthorizationError(parsed.error);
      }
      throw nonRetryable(`Slack refused the message: ${parsed.error ?? "unknown error"}`);
    }
  } catch (error) {
    if (error instanceof ApplicationAuthorizationError) {
      await markConnectionBroken(db, slack, error.message || "authorization was refused");
      throw nonRetryable(`Slack authorization failed: ${error.message}`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Jobs.
// ---------------------------------------------------------------------------

type ReviewJobPayload = { reviewId: string; organizationId: string };

async function enqueueReviewJob(
  db: Db,
  kind: typeof DELIVER_REVIEW_KIND | typeof RESUME_REVIEW_KIND,
  review: Pick<ReviewRequest, "id" | "organizationId">,
  maxAttempts: number
): Promise<void> {
  await db.createBackgroundJob({
    id: `${kind}:${review.id}`,
    organizationId: review.organizationId,
    kind,
    payload: { reviewId: review.id, organizationId: review.organizationId } satisfies ReviewJobPayload,
    maxAttempts,
  });
  getRuntimeHost().scheduleAfterResponse(async () => {
    const { runDueJobs } = await import("./jobs");
    await runDueJobs({ db }, { kinds: [DELIVER_REVIEW_KIND, RESUME_REVIEW_KIND], limit: 5 });
  });
}

export async function enqueueReviewResumptionJob(
  deps: { db: Db },
  review: Pick<ReviewRequest, "id" | "organizationId">
): Promise<void> {
  await enqueueReviewJob(deps.db, RESUME_REVIEW_KIND, review, 3);
}

export const deliverReviewRequestHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<ReviewJobPayload>;
    if (!payload.reviewId) throw nonRetryable("Invalid review delivery payload");
    const review = await deps.db.table("reviewRequests").get(payload.reviewId);
    if (!review || review.simulated) return;
    // Decided while the delivery waited in the ledger: nothing left to ask.
    if (review.status !== "pending") return;
    const flow = await deps.db.getFlow(review.flowId);
    const settings = flow?.actionSettings?.human_review;
    await deliverReviewRequest(
      review,
      {
        senderConnectionId: settings?.senderConnectionId,
        slackTarget: settings?.slackTarget,
      },
      { db: deps.db }
    );
  },
  async onTerminalFailure(record, deps, message) {
    const payload = record.payload as Partial<ReviewJobPayload>;
    if (!payload.reviewId || !payload.organizationId) return;
    await deps.db.raiseAlert(payload.organizationId, {
      type: "system",
      title: "A Human review request could not be delivered",
      detail: `${message} The Visitor is still waiting on review ${payload.reviewId}; an assignee can still decide it from the Inbox.`,
      sourceKey: `review-delivery:${payload.reviewId}`,
    });
  },
};

export const resumeReviewedConversationHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<ReviewJobPayload>;
    if (!payload.reviewId) throw nonRetryable("Invalid review resumption payload");
    await resumeReviewedConversation({ db: deps.db }, payload.reviewId);
  },
};

/**
 * Continue (or close) the Conversation a decided request belongs to. Idempotent:
 * `resumedAt` is set once the message exists, and the approval turn carries a
 * stable turn id, so a retried claim replays rather than answering twice.
 * Returns the assistant message that closed the gate, for the surfaces that
 * decide inline (the Preview).
 */
export async function resumeReviewedConversation(
  deps: ReviewJobDeps,
  reviewId: string
): Promise<{ messageId: string; content: ChatReplyPart[] } | null> {
  const { db } = deps;
  const review = await db.table("reviewRequests").get(reviewId);
  if (!review || review.status === "pending") return null;
  const conversation = await db.getConversation(review.conversationId);
  if (!conversation) return null;
  if (review.resumedAt) return lastAssistantMessage(db, conversation.id);

  if (review.status === "approved") {
    const resumed = await resumeGateTurn({
      db, conversation, gate: { kind: "review", request: review },
    });
    if (!resumed) {
      return null;
    }
  } else {
    const closed: ChatReplyPart[] = [
      reviewPart(review),
      { type: "text", action: "human_review", text: reviewHaltMessage(review) },
    ];
    await db.appendMessage({
      conversationId: conversation.id,
      requestId: `review-${review.id}-halt`,
      role: "assistant",
      content: closed,
      flowId: review.flowId,
    });
  }

  const now = (deps.now ?? (() => new Date()))().toISOString();
  await db.table("reviewRequests").update(review.id, { resumedAt: now });
  const fresh = await db.getConversation(conversation.id);
  if (fresh?.metadata.pendingReviewId === review.id) {
    await db.updateConversationMetadata(conversation.id, {
      ...fresh.metadata,
      pendingReviewId: null,
    });
  }
  return lastAssistantMessage(db, conversation.id);
}

/** The transcript card for a closed request. */
export function reviewPart(review: ReviewRequest): Extract<ChatReplyPart, { type: "human_review" }> {
  return {
    type: "human_review",
    action: "human_review",
    reviewId: review.id,
    title: review.title,
    status: review.status,
    // A Visitor's transcript never carries a Member's name (it may be their
    // email); the Inbox reads the decider from the row. A simulated request is
    // an operator's own transcript, where the name is the point of the card.
    decidedByName: review.simulated ? review.decidedByName : null,
    simulated: review.simulated,
  };
}

async function lastAssistantMessage(
  db: Db,
  conversationId: string
): Promise<{ messageId: string; content: ChatReplyPart[] } | null> {
  const recent = await db.listRecentMessages(conversationId, 4);
  const last = [...recent].reverse().find((message) => message.role === "assistant");
  return last ? { messageId: last.id, content: last.content as ChatReplyPart[] } : null;
}


// ---------------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------------

/**
 * pending + overdue then expired, then the halt path. Reads pending rows and
 * decides in memory, because the number of open requests at any moment is
 * small by construction (each one holds a Visitor's conversation).
 */
export async function expireDueReviews(
  deps: ReviewJobDeps
): Promise<{ expired: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const pending = await deps.db.table("reviewRequests").list({ status: "pending" }, { limit: 500 });
  let expired = 0;
  for (const review of pending) {
    const next = expireReview(review, now);
    if (!next) continue;
    // The same compare-and-set a decision uses: a Member who decided between
    // the list above and this write has closed the row, and the sweep must not
    // overwrite their decision with an expiry and halt what they approved.
    const settled = await deps.db.decideReviewRequest(review.id, {
      status: "expired",
      decision: null,
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
    });
    if (!settled) continue;
    await enqueueReviewResumptionJob(deps, settled);
    expired += 1;
  }
  return { expired };
}

/** The cron tick: expire what is overdue, then drain both job kinds. */
export async function runDueReviewJobs(deps: ReviewJobDeps): Promise<{
  expired: number;
  claimed: number;
  succeeded: number;
  failed: number;
}> {
  const { expired } = await expireDueReviews(deps);
  const { runDueJobs } = await import("./jobs");
  const result = await runDueJobs({ db: deps.db }, {
    kinds: [DELIVER_REVIEW_KIND, RESUME_REVIEW_KIND],
    now: (deps.now ?? (() => new Date()))(),
    limit: 20,
  });
  return { expired, claimed: result.claimed, succeeded: result.succeeded, failed: result.failed };
}
