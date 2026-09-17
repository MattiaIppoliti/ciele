/**
 * Slack mention replies (#857): the `answer_slack_mention` job kind.
 *
 * The web host verifies Slack's signature and hands a parsed mention to
 * `enqueueSlackMention`; everything after that runs here, through the same
 * ledger lifecycle every other job kind uses (`runDueJobs`), over the same
 * Slack transport the Import connector and the Human review sender use
 * (`defaultApplicationHttpClient`, `refreshApplicationCredentials`,
 * `ApplicationAuthorizationError`), and through the same conversation runtime
 * a published widget runs (`streamConversationTurn`).
 *
 * Three rules the handler enforces that a reviewer should be able to find in
 * one place:
 *
 * - **Delivery is at most once.** `deliveryAttempted` is checkpointed on the
 *   job before `chat.postMessage`. A reply Slack's own JSON says was not posted
 *   (`ok:false`) clears the flag again; a transport failure or a Slack
 *   `internal_error`/`fatal_error` (Slack documents those as "possibly
 *   partially succeeded") leaves it set, and the next attempt fails fast with
 *   an Alert instead of guessing.
 * - **A skipped mention is never a silent success.** Replies switched off
 *   while the job waited are recorded on the job payload; a channel the bot
 *   cannot answer in (not a member, archived, Slack Connect) or a Publication
 *   that no longer qualifies fails the job and raises the per-event Alert.
 * - **Third-party text is untrusted.** The channel transcript travels through
 *   the turn's untrusted-content fence, never as standing context.
 */
import { createHash } from "node:crypto";
import type {
  ApplicationConnection,
  BackgroundJob,
  Publication,
} from "@agent-hub/core";
import {
  sealSecret,
  slackBotConfig,
  slackBotReady,
  thrownMessage,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  ApplicationAuthorizationError,
  applicationCredentials,
  applicationRetryAfterMs,
  defaultApplicationHttpClient,
  refreshApplicationCredentials,
  trustedUrl,
  type ApplicationHttpClient,
} from "./application-provider-http";
import { connectorAlertKey } from "./connector-request";
import { alertKeys } from "./health";
import type { JobDeps, JobHandler, RunDueJobsResult } from "./jobs";
import { redactBearerSecrets } from "./redact";
import { consumeTurnStream, EMPTY_TURN_TRACE, type TurnView } from "./stream";
import type { ChatReplyPart } from "./types";

export interface SlackMention {
  eventId: string;
  teamId: string;
  appId: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs: string;
}

export interface SlackMentionJobPayload {
  mention: SlackMention;
  connectionId: string;
  assistantId: string;
  /** The generated reply, checkpointed so a delivery retry never reruns the turn. */
  reply?: string;
  /** Set before `chat.postMessage`; cleared only when Slack said it did not post. */
  deliveryAttempted?: boolean;
  /** Why a job finished without a reply, when that was the right outcome. */
  skipped?: SlackSkipReason;
}

export type SlackSkipReason =
  | "replies_disabled"
  | "connection_changed"
  | "assistant_changed";

export const SLACK_MENTION_JOB_KIND = "answer_slack_mention" as const;

/** Time the runtime is given for one model turn inside a 300-second host budget. */
const TURN_TIMEOUT_MS = 150_000;
/**
 * Everything one job can spend besides the turn: `conversations.info`, the
 * two context reads and `chat.postMessage`, each on the 30-second client
 * timeout. Reserved before a drain starts another job.
 */
const JOB_RESERVE_MS = TURN_TIMEOUT_MS + 4 * 30_000;
/** How long a claimed job may sit `running` before another drain reclaims it. */
export const SLACK_MENTION_STALE_MS = 11 * 60_000;

export function slackKey(...parts: string[]): string {
  return `slack_${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

const SLACK_HOSTS = ["slack.com"];

// ---------------------------------------------------------------------------
// Routing: one workspace channel resolves to one Organization, or to nobody.
// ---------------------------------------------------------------------------

async function slackCandidates(
  db: Db,
  mention: SlackMention
): Promise<ApplicationConnection[]> {
  return (await db.listSlackWorkspaceConnections(mention.teamId)).filter(
    (connection) =>
      connection.status === "connected" &&
      connection.ownerType === "organization" &&
      connection.metadata.slackAppId === mention.appId &&
      (slackBotConfig(connection.metadata)?.channelIds.includes(mention.channel) ?? false)
  );
}

export type SlackRouting =
  | { kind: "one"; connection: ApplicationConnection }
  | { kind: "none" }
  | { kind: "conflict"; candidates: ApplicationConnection[] };

/**
 * A workspace/channel resolves to one Organization, or to nobody. The three
 * outcomes stay apart because they mean different things to a caller: nobody
 * is an opt-out, two is a misconfiguration somebody has to be told about.
 */
export async function resolveSlackRouting(
  db: Db,
  mention: SlackMention
): Promise<SlackRouting> {
  const candidates = await slackCandidates(db, mention);
  if (candidates.length === 1) return { kind: "one", connection: candidates[0]! };
  return candidates.length === 0 ? { kind: "none" } : { kind: "conflict", candidates };
}

/** The single owner of this channel, or null for both of the other outcomes. */
export async function resolveSlackConnection(
  db: Db,
  mention: SlackMention
): Promise<ApplicationConnection | null> {
  const routing = await resolveSlackRouting(db, mention);
  return routing.kind === "one" ? routing.connection : null;
}

/**
 * Raises the conflict Alert on every Organization currently claiming the
 * channel and clears it on every other Organization connected to the same
 * workspace. Clearing the other side is the point: the admin who removes the
 * channel is the one who fixed it, and leaving their Alert up would ask them
 * to fix it again, about a row RLS does not let them see.
 */
async function reconcileChannelConflict(
  db: Db,
  mention: SlackMention,
  candidates: ApplicationConnection[]
): Promise<void> {
  const conflictKey = alertKeys.slackChannelConflict(mention.teamId, mention.channel);
  const claiming = new Set(candidates.map((candidate) => candidate.organizationId));
  const conflicted = claiming.size > 1;
  const workspace = await db.listSlackWorkspaceConnections(mention.teamId);
  const organizationIds = new Set([
    ...workspace.map((connection) => connection.organizationId),
    ...claiming,
  ]);
  for (const organizationId of organizationIds) {
    if (conflicted && claiming.has(organizationId)) {
      await db.raiseAlert(organizationId, {
        sourceKey: conflictKey,
        type: "integration",
        title: "A Slack channel is enabled on more than one Organization",
        detail:
          `Channel ${mention.channel} in workspace ${mention.teamId} is selected in the Slack assistant settings of ${claiming.size} Organizations. ` +
          "Ciele answers no mention there until exactly one keeps it. Remove the channel from the other Organizations' Slack assistant settings.",
      });
    } else {
      await db.resolveAlertsByKey(organizationId, conflictKey);
    }
  }
}

/**
 * Queues the reply job for a verified mention. Returns false when no single
 * Organization owns the channel. Two Organizations claiming one channel is a
 * configuration conflict neither admin can see from their own console (RLS
 * hides the other row), so it is the one routing outcome that raises an
 * Alert, on every Organization involved, and clears again once one of them
 * gives the channel up.
 */
export async function enqueueSlackMention(
  db: Db,
  mention: SlackMention
): Promise<boolean> {
  const routing = await resolveSlackRouting(db, mention);
  await reconcileChannelConflict(
    db,
    mention,
    routing.kind === "conflict" ? routing.candidates : routing.kind === "one" ? [routing.connection] : []
  );
  if (routing.kind !== "one") return false;
  const connection = routing.connection;
  const config = slackBotConfig(connection.metadata)!;
  const payload: SlackMentionJobPayload = {
    mention,
    connectionId: connection.id,
    assistantId: config.assistantId,
  };
  await db.createBackgroundJob({
    id: slackKey(mention.appId, mention.eventId),
    organizationId: connection.organizationId,
    kind: SLACK_MENTION_JOB_KIND,
    payload: payload as unknown as Record<string, unknown>,
    maxAttempts: 3,
  });
  return true;
}

// ---------------------------------------------------------------------------
// The Slack Web API, over the shared egress client.
// ---------------------------------------------------------------------------

type SlackMethod =
  | "conversations.info"
  | "conversations.history"
  | "conversations.replies"
  | "chat.postMessage";

const SLACK_AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);

/**
 * `chat.postMessage` refusals whose meaning is "not posted, and posting again
 * will not help": the reply is dropped and the operator told why.
 */
const SLACK_POST_PERMANENT = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "msg_too_long",
  "no_text",
  "restricted_action",
  "restricted_action_read_only_channel",
  "restricted_action_thread_only_channel",
  "restricted_action_non_threadable_channel",
  "invalid_arguments",
  "invalid_blocks",
  "missing_scope",
  "not_allowed_token_type",
  "ekm_access_denied",
  "team_access_not_granted",
]);

/**
 * Outcomes that leave delivery genuinely unknown, so a repost could duplicate
 * a message the customer already has: Slack's own two "may have partially
 * succeeded" codes, and `invalid_response`, which is a 2xx whose body did not
 * parse. A proxy that mangles the body after Slack accepted the post looks
 * exactly like one that mangles it after Slack rejected it.
 */
const SLACK_POST_AMBIGUOUS = new Set([
  "internal_error",
  "fatal_error",
  "invalid_response",
]);

export class SlackApiError extends Error {
  /** Read by the job ledger: `false` ends the job, `retryAfterMs` paces a retry. */
  retryable: boolean;
  retryAfterMs: number;

  constructor(
    public readonly code: string,
    public readonly method: SlackMethod,
    options: { retryable?: boolean; retryAfterMs?: number; detail?: string } = {}
  ) {
    super(`Slack ${method}: ${code}${options.detail ? ` (${options.detail})` : ""}`);
    this.name = "SlackApiError";
    this.retryable = options.retryable ?? true;
    this.retryAfterMs = options.retryAfterMs ?? 0;
  }
}

/** The `ok:false` JSON refusals: Slack said so, the message was not posted. */
export function isSlackRefusal(error: unknown): error is SlackApiError {
  return (
    error instanceof SlackApiError &&
    !error.code.startsWith("http_") &&
    !SLACK_POST_AMBIGUOUS.has(error.code)
  );
}

function slackErrorDetail(result: Record<string, unknown>): string | undefined {
  const metadata = result.response_metadata as { messages?: unknown } | undefined;
  if (!Array.isArray(metadata?.messages)) return undefined;
  const messages = metadata.messages
    .filter((message): message is string => typeof message === "string")
    .map((message) => message.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return messages.length ? messages.join("; ").slice(0, 500) : undefined;
}

/**
 * One Slack Web API call. Slack documents JSON bodies for its write methods
 * and ordinary form parameters for the `conversations.*` reads, which answer
 * `invalid_arguments` to JSON even when the channel id is valid.
 */
export async function slackApi(
  client: ApplicationHttpClient,
  token: string,
  method: SlackMethod,
  parameters: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const json = method === "chat.postMessage";
  const body = json
    ? JSON.stringify(parameters)
    : new URLSearchParams(
        Object.entries(parameters).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, String(value)]]
        )
      ).toString();
  const response = await client(trustedUrl(`https://slack.com/api/${method}`, SLACK_HOSTS), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": json
        ? "application/json; charset=utf-8"
        : "application/x-www-form-urlencoded; charset=utf-8",
    },
    body,
  });
  if (response.status === 429) {
    throw new SlackApiError("ratelimited", method, {
      retryAfterMs: Math.max(1_000, applicationRetryAfterMs(response.headers)),
    });
  }
  if (!response.ok) throw new SlackApiError(`http_${response.status}`, method);
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(response.text) as Record<string, unknown>;
  } catch {
    throw new SlackApiError("invalid_response", method);
  }
  if (result.ok !== true) {
    const code = typeof result.error === "string" ? result.error : "invalid_response";
    if (SLACK_AUTH_ERRORS.has(code)) {
      throw new ApplicationAuthorizationError(`Slack rejected the token (${code})`);
    }
    throw new SlackApiError(code, method, {
      retryable: !SLACK_POST_PERMANENT.has(code),
      detail: slackErrorDetail(result),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Render only user-facing parts. Tool traces and internal context never go to Slack. */
export function slackReply(parts: readonly ChatReplyPart[]): string {
  return parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "clarify") return [part.question];
      if (part.type === "notification") return [part.content];
      if (part.type === "sources")
        return part.sources.map((source) => {
          const name = source.sourceName || source.conceptTitle;
          const url =
            source.url && /^https?:\/\//.test(source.url) ? `: ${source.url}` : "";
          return `Source: ${name}${url}`;
        });
      if (
        part.type === "button" &&
        part.buttonType === "external_link" &&
        /^https?:\/\//.test(part.url ?? "")
      ) {
        return [`${part.label}: ${part.url}`];
      }
      return [];
    })
    .map(escape)
    .join("\n\n")
    .slice(0, 35_000);
}

export interface SlackChannelContext {
  /** Trusted framing for the model: what the transcript is and how to treat it. */
  instruction: string;
  /** The transcript itself, to be fenced as untrusted third-party text. */
  transcript: string;
  incomplete: boolean;
}

/**
 * Up to 15 channel messages and, for a thread, up to 15 thread replies before
 * the mention. Slack's distributed-app tier can limit `conversations.history`
 * to one request a minute, so a missing page is marked rather than papered
 * over: the model is told the context is partial and never claims to have read
 * the whole channel.
 */
export async function slackChannelContext(
  client: ApplicationHttpClient,
  token: string,
  mention: SlackMention
): Promise<SlackChannelContext> {
  const collected = await Promise.allSettled([
    slackApi(client, token, "conversations.history", {
      channel: mention.channel,
      limit: 15,
      latest: mention.ts,
    }),
    ...(mention.threadTs !== mention.ts
      ? [
          slackApi(client, token, "conversations.replies", {
            channel: mention.channel,
            ts: mention.threadTs,
            latest: mention.ts,
            limit: 15,
          }),
        ]
      : []),
  ]);
  const messages = new Map<string, { ts: string; user: string; text: string }>();
  let incomplete = false;
  for (const result of collected) {
    if (result.status === "rejected") {
      incomplete = true;
      continue;
    }
    if (result.value.has_more) incomplete = true;
    for (const value of Array.isArray(result.value.messages) ? result.value.messages : []) {
      const row = value as Record<string, unknown>;
      if (
        typeof row.ts !== "string" ||
        typeof row.text !== "string" ||
        Number(row.ts) >= Number(mention.ts)
      )
        continue;
      messages.set(row.ts, {
        ts: row.ts,
        user: String(row.user ?? "bot"),
        text: row.text.slice(0, 2000),
      });
    }
  }
  const transcript = JSON.stringify({
    channel: mention.channel,
    thread: mention.threadTs,
    incomplete,
    messages: [...messages.values()]
      .sort((a, b) => Number(a.ts) - Number(b.ts))
      .slice(-30),
  }).slice(0, 30_000);
  return {
    instruction:
      "You are answering a mention in Slack. Respond to the current question in its language. " +
      "Use the Assistant's linked knowledge and, when relevant, the partial Slack channel transcript supplied as retrieved material. " +
      "Do not claim to have read messages outside that window. " +
      "If the transcript is marked incomplete and the answer depends on missing messages, ask for the relevant excerpt.",
    transcript,
    incomplete,
  };
}

// ---------------------------------------------------------------------------
// The handler.
// ---------------------------------------------------------------------------

/** A failure the ledger must not retry: the next attempt would find the same state. */
function nonRetryable(message: string): Error & { retryable: false } {
  return Object.assign(new Error(message), { retryable: false as const });
}

async function openSlackCredentials(
  db: Db,
  connection: ApplicationConnection,
  client: ApplicationHttpClient
) {
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

/**
 * A revoked or expired token does not fix itself on the next attempt: the
 * connection row says so, under the same Alert key the OAuth callback clears,
 * so the Applications panel offers Reconnect instead of N per-mention Alerts.
 */
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
    detail: `A Slack mention could not be answered through the Slack connection "${connection.name}": ${message}. Reconnect it under Knowledge → Applications; mentions will not be answered until then.`,
    sourceKey: connectorAlertKey(connection.id),
  });
}

function qualifyingPublication(
  publication: Publication | null,
  organizationId: string
): Publication {
  if (!publication || publication.config.assistant.organizationId !== organizationId) {
    throw nonRetryable("The Slack Assistant is not published by this Organization");
  }
  if (publication.config.assistant.requireSignIn) {
    throw nonRetryable(
      "The Slack Assistant requires sign-in; Slack identity is not linked to Ciele SSO"
    );
  }
  return publication;
}

async function answer(
  deps: JobDeps,
  connection: ApplicationConnection,
  mention: SlackMention,
  assistantId: string,
  token: string,
  client: ApplicationHttpClient
): Promise<string> {
  const publication = qualifyingPublication(
    await deps.db.getLatestPublication(assistantId),
    connection.organizationId
  );
  const config = publication.config;
  // One Visitor per Slack user (Insights counts identities by subject), one
  // Conversation per (thread, user) so each person's own exchange stays a
  // thread the runtime can continue; other people's words arrive as context.
  const subjectId = slackKey(mention.teamId, mention.user);
  const conversationId = slackKey(
    connection.id,
    assistantId,
    mention.channel,
    mention.threadTs,
    mention.user
  );
  const [, context, connections] = await Promise.all([
    deps.db.createConversation({
      id: conversationId,
      assistantId,
      subjectType: "visitor",
      subjectId,
      title: `Slack · ${mention.channel}`,
      metadata: {
        origin: "slack",
        launchUrl: `https://app.slack.com/client/${mention.teamId}/${mention.channel}`,
      },
    }),
    slackChannelContext(client, token, mention),
    deps.db.listProviderConnections(connection.organizationId),
  ]);
  const botId = String(connection.metadata.slackBotUserId);
  // Loaded lazily: `turn.ts` reaches `jobs.ts`, which registers this handler,
  // so a static import would leave the registry entry undefined at load time.
  const runTurn = deps.runTurn ?? (await import("./turn")).streamConversationTurn;
  const stream = await runTurn({
    db: deps.db,
    systemDb: deps.db,
    assistant: {
      ...config.assistant,
      createdAt: publication.createdAt,
      updatedAt: publication.createdAt,
    },
    flows: config.flows,
    skills: config.skills ?? [],
    entities: config.entities ?? [],
    connections,
    organizationId: connection.organizationId,
    subjectType: "visitor",
    subjectId,
    conversationId,
    turnId: slackKey(mention.appId, mention.eventId),
    message: mention.text.replaceAll(`<@${botId}>`, "").trim() || "Hello",
    standingContext: [context.instruction],
    untrustedContext: [
      {
        provenance: "Slack channel transcript, other people's messages, partial",
        body: context.transcript,
      },
    ],
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    // No personal subscription or fabricated Ciele Member identity for Slack traffic.
  });
  let view: TurnView = { ...EMPTY_TURN_TRACE, parts: [], streamingText: null };
  let done = false;
  // The same event consumer as Ciele chat: generated text arrives as
  // text-start/delta/end, while citations and verbatim messages arrive as parts.
  await consumeTurnStream(stream, {
    update: (apply) => {
      view = apply(view);
    },
    onDone: () => {
      done = true;
    },
    onEvent: (event) => {
      if (event.type === "error")
        throw new Error(event.message || "Ciele could not complete the Slack turn");
    },
  });
  if (!done) throw new Error("Slack turn did not complete");
  return (
    slackReply(view.parts) ||
    "I could not produce a text response. Please ask another question."
  );
}

export const answerSlackMentionHandler: JobHandler = {
  /**
   * The ledger persists whatever a handler throws, so the redaction happens on
   * the way out rather than only on the Alert: a provider error that echoed an
   * `Authorization` header would otherwise sit in `background_jobs.error` on
   * every attempt. The retry contract rides along untouched.
   */
  async perform(record, deps) {
    try {
      await answerSlackMention(record, deps);
    } catch (error) {
      const detail = slackFailureDetail(error);
      if (error instanceof Error && error.message === detail) throw error;
      throw Object.assign(new Error(detail), {
        retryable:
          typeof error === "object" && error !== null && "retryable" in error
            ? (error as { retryable?: unknown }).retryable
            : undefined,
        retryAfterMs:
          typeof error === "object" && error !== null && "retryAfterMs" in error
            ? (error as { retryAfterMs?: unknown }).retryAfterMs
            : undefined,
      });
    }
  },

  async onTerminalFailure(record, deps, message) {
    if (!record.organizationId) return;
    await deps.db.raiseAlert(record.organizationId, {
      sourceKey: alertKeys.slackMention(record.id),
      type: "integration",
      title: "Slack reply needs attention",
      detail: `Ciele could not answer a Slack mention: ${slackFailureDetail(message)} Check the connection and the thread before retrying, to avoid a duplicate message.`,
    });
  },
};

async function answerSlackMention(
  record: BackgroundJob,
  deps: JobDeps
): Promise<void> {
  if (!record.leaseToken) throw nonRetryable("Claimed Slack job has no lease token");
  const leaseToken = record.leaseToken;
  const payload = { ...(record.payload as unknown as SlackMentionJobPayload) };
  const mention = payload.mention;
  if (!mention?.eventId || !mention.channel || !mention.teamId) {
    throw nonRetryable("Invalid Slack mention payload");
  }
  const checkpoint = async () => {
    const kept = await deps.db.checkpointBackgroundJob({
      id: record.id,
      leaseToken,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (!kept) throw new Error("Slack worker lease lost");
  };
  const skip = async (reason: SlackSkipReason) => {
    payload.skipped = reason;
    await checkpoint();
  };

  // Recheck the opt-in at execution: queued work after a disconnect or an
  // opt-out is not a reply anybody still wants, and it is not an error either.
  // A channel a second Organization claimed while the job waited is neither:
  // it is the misconfiguration `enqueueSlackMention` alerts on, and it has to
  // reach the same Alert rather than be filed as somebody's opt-out.
  const routing = await resolveSlackRouting(deps.db, mention);
  if (routing.kind === "conflict") {
    await reconcileChannelConflict(deps.db, mention, routing.candidates);
    throw nonRetryable(
      `Slack channel ${mention.channel} is enabled on more than one Organization`
    );
  }
  if (routing.kind === "none") return skip("replies_disabled");
  const connection = routing.connection;
  if (
    connection.id !== payload.connectionId ||
    connection.organizationId !== record.organizationId
  ) {
    return skip("connection_changed");
  }
  if (slackBotConfig(connection.metadata)?.assistantId !== payload.assistantId) {
    return skip("assistant_changed");
  }
  if (!slackBotReady(connection)) {
    throw nonRetryable("Reconnect Slack to grant the conversational permissions");
  }
  if (payload.deliveryAttempted) {
    throw nonRetryable(
      "Slack delivery outcome unknown; automatic repost suppressed. Check the thread before retrying."
    );
  }

  const secret = await deps.db.getApplicationConnection(connection.id);
  if (!secret || secret.organizationId !== record.organizationId) {
    throw nonRetryable("Slack connection unavailable");
  }
  const client = deps.applicationHttpClient ?? defaultApplicationHttpClient;
  try {
    const credentials = await openSlackCredentials(deps.db, secret, client);
    // The second, independent binding between this token and this workspace:
    // routing matched `provider_account_id`, this matches what the token was
    // actually minted for. An absent teamId is a bundle we cannot vouch for.
    if (credentials.teamId !== mention.teamId) {
      throw nonRetryable("Slack workspace mismatch");
    }
    const token = credentials.accessToken;

    if (typeof payload.reply !== "string") {
      // A channel allowlist is a publication audience. A channel the bot is
      // not in, an archived one, or Slack Connect is not that audience.
      const info = await slackApi(client, token, "conversations.info", {
        channel: mention.channel,
      });
      const channel = info.channel as Record<string, unknown> | undefined;
      if (!channel || channel.id !== mention.channel) {
        throw nonRetryable(`Slack channel ${mention.channel} was not found`);
      }
      if (channel.is_member !== true) {
        throw nonRetryable(
          `Ciele is not a member of Slack channel ${mention.channel}. Invite it or remove the channel from the Slack assistant settings.`
        );
      }
      if (channel.is_archived) {
        throw nonRetryable(`Slack channel ${mention.channel} is archived`);
      }
      if (channel.is_ext_shared || channel.is_org_shared || channel.is_pending_ext_shared) {
        throw nonRetryable(
          `Slack channel ${mention.channel} is shared outside the workspace; Slack Connect channels are not supported`
        );
      }
      payload.reply = await answer(deps, connection, mention, payload.assistantId, token, client);
      await checkpoint();
    }

    // A model turn can take minutes. Respect an opt-out or unpublish while it
    // ran; a conflict that appeared meanwhile is still a conflict, and the
    // generated reply stays on the job so the fix does not cost another turn.
    const after = await resolveSlackRouting(deps.db, mention);
    if (after.kind === "conflict") {
      await reconcileChannelConflict(deps.db, mention, after.candidates);
      throw nonRetryable(
        `Slack channel ${mention.channel} is enabled on more than one Organization`
      );
    }
    if (
      after.kind !== "one" ||
      after.connection.id !== connection.id ||
      slackBotConfig(after.connection.metadata)?.assistantId !== payload.assistantId
    ) {
      return skip("replies_disabled");
    }
    qualifyingPublication(
      await deps.db.getLatestPublication(payload.assistantId),
      record.organizationId ?? connection.organizationId
    );

    // Persist BEFORE sending. Slack offers no atomic commit with our ledger; an
    // ambiguous timeout must not blindly repost a customer's answer.
    payload.deliveryAttempted = true;
    await checkpoint();
    try {
      await slackApi(client, token, "chat.postMessage", {
        channel: mention.channel,
        thread_ts: mention.threadTs,
        text: payload.reply,
        unfurl_links: false,
        unfurl_media: false,
        parse: "none",
        link_names: false,
      });
    } catch (error) {
      // Slack said it did not post (an `ok:false` body, or a 429 before the
      // request was accepted): the reply is safe to send again, or, for a
      // permanent refusal, safe to drop with an accurate reason.
      if (isSlackRefusal(error) || error instanceof ApplicationAuthorizationError) {
        payload.deliveryAttempted = false;
        // Best effort: losing the reset costs one retry that refuses to
        // repost, which is the safe direction. Losing the refusal itself
        // would cost the operator the only accurate account of what Slack
        // said, so the original error always wins.
        await checkpoint().catch((reason) =>
          console.error("[slack] could not clear the delivery flag", reason)
        );
      }
      throw error;
    }
    // The message is in the thread. Nothing after this point may turn a
    // confirmed delivery into a failed job, because the retry would read
    // `deliveryAttempted` and report an outcome nobody is unsure about.
    await deps.db
      .resolveAlertsByKey(connection.organizationId, alertKeys.slackMention(record.id))
      .catch((reason) => console.error("[slack] could not clear the mention alert", reason));
  } catch (error) {
    if (error instanceof ApplicationAuthorizationError) {
      await markConnectionBroken(deps.db, connection, error.message);
    }
    throw error;
  }
}

/** Keep operator diagnostics useful without ever persisting credentials. */
export function slackFailureDetail(error: unknown): string {
  const message = typeof error === "string" ? error : thrownMessage(error, "Unknown error");
  return (
    redactBearerSecrets(message)
      .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500) || "Unknown error"
  );
}

/**
 * The drain the two web adapters call (the signed event route's after-response
 * hook and the cron tick). Claims one job at a time, because a claim is a lease
 * on a model turn that may take minutes, and stops starting new ones once the
 * remaining host budget could not fit a full job: a job the platform kills
 * between the delivery checkpoint and Slack's answer is exactly the "outcome
 * unknown" case the handler then refuses to guess about.
 */
export async function runDueSlackMentionJobs(
  deps: JobDeps,
  options: { budgetMs?: number; limit?: number; now?: () => number } = {}
): Promise<RunDueJobsResult> {
  const { runDueJobs } = await import("./jobs");
  const now = options.now ?? Date.now;
  const startedAt = now();
  const budgetMs = options.budgetMs ?? 300_000;
  const limit = options.limit ?? 5;
  const total: RunDueJobsResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    superseded: 0,
  };
  for (let i = 0; i < limit; i += 1) {
    if (i > 0 && now() - startedAt > budgetMs - JOB_RESERVE_MS) break;
    const result = await runDueJobs(deps, {
      kinds: [SLACK_MENTION_JOB_KIND],
      limit: 1,
      staleAfterMs: SLACK_MENTION_STALE_MS,
    });
    for (const key of Object.keys(total) as (keyof RunDueJobsResult)[]) {
      total[key] += result[key];
    }
    if (result.claimed === 0 && result.failed === 0 && result.superseded === 0) break;
  }
  return total;
}
