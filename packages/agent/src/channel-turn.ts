import type {
  AiUsageInput,
  ChainCapReason,
  ChannelMessage,
  ChannelRosterEntry,
  ProviderConnection,
  StoredTurnTrace,
  Teammate,
  TeammateChannel,
} from "@agent-hub/core";
import {
  chainCapMarker,
  chainTurnVerdict,
  channelPromptSection,
  mentionedTeammateIds,
  messageText,
  parseChannelMentions,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import type { HistoryMessage, RuntimeEvent } from "./engine";
import { resolveChatModel } from "./models";
import { createTurnSession } from "./session";
import { getRuntimeHost } from "./host";
import { buildTemplateContext, platformAppOrigin } from "./template";
import {
  executeTeammateAnswer,
  teammateMemorySections,
} from "./teammate-answer";
import {
  admitAiSpend,
  CONVERSATION_SPEND_CAPACITY,
  type AiConnectionKind,
  type AiSpendBlock,
} from "./spend-admission";
import type {
  ChannelEvent,
  ChatReplyPart,
  TeammateActionTool,
} from "./types";

/**
 * The channel chain (#778): everything one human message sets off in a Teammate
 * channel.
 *
 * A chain is a loop, not a recursion: the Teammates a message addressed are
 * queued, each takes a turn, and whoever it addresses in its reply joins the
 * back of the queue. Written this way because the caps are properties of the
 * chain rather than of a call stack, so the loop can ask one pure question
 * (`chainTurnVerdict`) before every turn and stop with a marker instead of
 * unwinding.
 *
 * Three rules hold whatever the models say:
 *
 * - **Mention-only.** A Teammate takes a turn because somebody named it. There
 *   is no default responder and no self-activation, so an unmentioned Teammate
 *   sitting in the channel is silent by construction, not by policy.
 * - **The channel is the perimeter.** Mentions resolve against the roster and
 *   nothing else (`parseChannelMentions`), so a Teammate cannot reach a
 *   colleague outside the channel, and never an Assistant.
 * - **The chain-starter is the invoker.** Every turn, and therefore every
 *   mutation a granted Teammate makes, records the Member whose message started
 *   the chain. Nobody's fan-out is attributed to nobody.
 *
 * Providers: no `keyResolution`, ever. A Member's own subscription may run their
 * own 1:1 turns (ADR-0007 as amended by #769); a chain is multi-party traffic,
 * which is not personal use, so it runs on the Organization's connections.
 */

/** One Teammate's turn in a channel, as the chain runner needs it. */
export interface ChannelTurnRequest {
  teammate: Teammate;
  /** The transcript so far, oldest-first, including the message that called it. */
  history: readonly ChannelMessage[];
  /** The message that addressed it. */
  trigger: ChannelMessage;
  emit: (event: RuntimeEvent) => void;
  signal: AbortSignal;
}

export interface ChannelTurnResult {
  parts: ChatReplyPart[];
  trace: StoredTurnTrace | null;
  /** Actual model usage, settled against this speaker's admission. */
  usage?: AiUsageInput[];
  /** Record success only after the reply has a durable Channel message ID. */
  recordSucceeded?: (messageId: string) => Promise<void>;
}

/**
 * How one turn is run. The real implementation calls the model; the chain tests
 * pass their own, which is what makes "the eleventh turn never runs" assertable
 * without a provider.
 */
export type ChannelTurnRunner = (
  request: ChannelTurnRequest,
) => Promise<ChannelTurnResult>;

export interface ChannelChainInput {
  db: Db;
  organizationId: string;
  channel: TeammateChannel;
  /** Everyone seated: the complete set of names a mention can resolve to. */
  roster: readonly ChannelRosterEntry[];
  /** The seated Teammates, the only participants that can take a turn. */
  teammates: readonly Teammate[];
  connections: ProviderConnection[];
  /** The human message that starts the chain, already persisted. */
  startMessage: ChannelMessage;
  /** Who wrote it: the invoker of every turn in this chain (story 8). */
  startedBy: { userId: string; name?: string | null };
  /** The Teammates it addressed, in order. */
  targets: readonly string[];
  /**
   * What each Teammate was granted (#770), resolved by the host from its grant
   * rows. Unwired, a channel turn can talk and search and nothing else.
   */
  teammateActions?: (
    teammate: Teammate,
  ) => Promise<readonly TeammateActionTool[]>;
  /** Test seam. Defaults to the real model turn. */
  runTurn?: ChannelTurnRunner;
  signal: AbortSignal;
}

/** Response headers matching the ndjson framing. */
export const CHANNEL_NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache",
} as const;

/** How much of a channel transcript a turn reads as history. */
const CHANNEL_HISTORY_LIMIT = 24;

/**
 * Run the chain, streaming ndjson: one `channel-speaker` per turn, that turn's
 * own runtime events, then the persisted `channel-message`.
 *
 * The stream is the same shape the 1:1 chat consumes, with an envelope saying
 * who is talking, so the console renders a channel with the transcript
 * component it already has. An unattended caller can drain it and get the same
 * persistence, exactly like a Routine run.
 */
export async function streamChannelChain(
  input: ChannelChainInput,
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const runTurn =
    input.runTurn ?? ((request) => modelChannelTurn(input, request));

  return new ReadableStream({
    async start(controller) {
      const emit = (event: RuntimeEvent | ChannelEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      let turns = 0;
      let capped: ChainCapReason | null = null;
      try {
        const outcome = await runChain(input, runTurn, emit);
        turns = outcome.turns;
        capped = outcome.capped;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (!input.signal.aborted) emit({ type: "error", message });
      } finally {
        emit({
          type: "channel-end",
          chainId: input.startMessage.id,
          turns,
          capped,
        });
        controller.close();
      }
    },
  });
}

/** The loop itself, kept apart from the framing so it can be read in one go. */
async function runChain(
  input: ChannelChainInput,
  runTurn: ChannelTurnRunner,
  emit: (event: RuntimeEvent | ChannelEvent) => void,
): Promise<{ turns: number; capped: ChainCapReason | null }> {
  const { db, channel, startMessage } = input;
  const byId = new Map(input.teammates.map((t) => [t.id, t]));
  const queue: Array<{ teammateId: string; trigger: ChannelMessage }> =
    input.targets
      .filter((id) => byId.has(id))
      .map((id) => ({ teammateId: id, trigger: startMessage }));

  // What this chain already spent, read from the transcript rather than from a
  // counter: a retried or half-failed chain is then accounted from what actually
  // happened, and there is no second number to disagree with the record.
  const existing = await db.listChannelChainMessages(
    channel.id,
    startMessage.id,
  );
  const taken = existing
    .filter((message) => message.authorType === "teammate")
    .map((message) => message.authorTeammateId)
    .filter((id): id is string => Boolean(id));

  let history = await db.listChannelMessages(channel.id, CHANNEL_HISTORY_LIMIT);
  let capped: ChainCapReason | null = null;

  // Turns this call ran. `taken` counts the whole chain (a resumed one included),
  // and the caller wants to know what just happened.
  let ran = 0;
  // One marker per teammate that hit its own cap, and one for the chain: a
  // marker per dropped mention would bury the transcript in bookkeeping.
  const markedTeammates = new Set<string>();
  const spendBlockedTeammates = new Set<string>();

  while (queue.length > 0) {
    if (input.signal.aborted) break;
    const next = queue.shift()!;
    const teammate = byId.get(next.teammateId);
    if (!teammate) continue;

    const verdict = chainTurnVerdict(taken, teammate.id);
    if (!verdict.run) {
      if (verdict.reason === "chain_cap") {
        // The chain is over: whatever is still queued is dropped, and the
        // transcript says so rather than looking like nobody answered.
        capped = "chain_cap";
        history = [
          ...history,
          await appendMarker(input, chainCapMarker("chain_cap")),
        ].slice(-CHANNEL_HISTORY_LIMIT);
        emit({ type: "channel-message", message: history[history.length - 1] });
        break;
      }
      capped ??= "teammate_cap";
      if (!markedTeammates.has(teammate.id)) {
        markedTeammates.add(teammate.id);
        const marker = await appendMarker(
          input,
          chainCapMarker("teammate_cap", teammate.name),
        );
        history = [...history, marker].slice(-CHANNEL_HISTORY_LIMIT);
        emit({ type: "channel-message", message: marker });
      }
      continue;
    }

    // Admit every speaker immediately before it spends. Besides bounding the
    // complete ten-turn Chain, this checks Teammates introduced by a model's
    // reply instead of only the names present in the human's first message.
    const spendAdmission = await admitAiSpend({
      db,
      organizationId: input.organizationId,
      connectionKinds: channelConnectionKinds(input, [teammate.id]),
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    if (spendAdmission.blocked) {
      if (!spendBlockedTeammates.has(teammate.id)) {
        spendBlockedTeammates.add(teammate.id);
        const marker = await appendMarker(
          input,
          channelSpendBlockMessage(spendAdmission.blocked),
        );
        history = [...history, marker].slice(-CHANNEL_HISTORY_LIMIT);
        emit({ type: "channel-message", message: marker });
      }
      // Budget and activation apply to the whole Organization. A usage block
      // can be credential-specific, so other queued Teammates may still run.
      if (spendAdmission.blocked.reason !== "usage") break;
      continue;
    }

    emit({
      type: "channel-speaker",
      teammateId: teammate.id,
      teammateName: teammate.name,
    });
    let result: ChannelTurnResult;
    try {
      result = await runTurn({
        teammate,
        history,
        trigger: next.trigger,
        // A ChannelTurnRunner owns the public projection of its runtime
        // events. The real runner does that through createTurnObserver; test
        // runners emit only the already-public fixtures they assert against.
        emit: (event) => emit(event),
        signal: input.signal,
      });
    } catch (error) {
      // One Teammate's failure is not the chain's: the others were asked too,
      // and a silent gap reads as "it ignored me". The failed turn still counts
      // against the caps, so a broken provider cannot be re-queued forever, and
      // the marker is written as that Teammate rather than as the runtime for
      // the same reason: `taken` is rebuilt from the teammate-authored
      // messages, so a failure filed under `system` would hand the Teammate its
      // budget back the moment the chain resumed.
      taken.push(teammate.id);
      ran += 1;
      const detail = error instanceof Error ? error.message : "Unknown error";
      if (!input.signal.aborted) emit({ type: "error", message: detail });
      const marker = await appendMarker(
        input,
        `Could not answer: ${detail}`,
        teammate
      );
      history = [...history, marker].slice(-CHANNEL_HISTORY_LIMIT);
      emit({ type: "channel-message", message: marker });
      await spendAdmission.release();
      continue;
    }
    taken.push(teammate.id);
    ran += 1;

    // What the reply addressed. Resolved against the roster, so a name from
    // outside the channel is ordinary text; and never itself, because a
    // self-mention would spend a chain turn talking to nobody.
    const mentions = parseChannelMentions(
      messageText(result.parts),
      input.roster,
    ).filter((id) => id !== teammate.id);

    try {
      const saved = await db.appendChannelMessage({
        organizationId: input.organizationId,
        channelId: channel.id,
        authorType: "teammate",
        authorTeammateId: teammate.id,
        content: result.parts,
        mentions,
        chainId: startMessage.id,
        trace: result.trace,
      });
      await result.recordSucceeded?.(saved.id);
      history = [...history, saved].slice(-CHANNEL_HISTORY_LIMIT);
      emit({ type: "channel-message", message: saved });

      for (const id of mentionedTeammateIds(mentions, input.roster)) {
        queue.push({ teammateId: id, trigger: saved });
      }
    } finally {
      // The model spent even when persistence or telemetry failed. Settle that
      // usage before letting the reservation lifecycle close.
      await spendAdmission.settle(result.usage ?? []);
      await spendAdmission.release();
    }
  }

  return { turns: ran, capped };
}

/** Credential meters this queued Chain can spend; unresolved models spend none. */
function channelConnectionKinds(
  input: ChannelChainInput,
  queuedTeammateIds: readonly string[],
): AiConnectionKind[] {
  return [
    ...new Set(
      queuedTeammateIds
        .map((id) => input.teammates.find((teammate) => teammate.id === id))
        .map((teammate) =>
          teammate
            ? resolveChatModel(
                teammate.modelProvider,
                teammate.modelId,
                input.connections,
              )?.credentialKind
            : undefined,
        )
        // No model resolves: nothing is funded, so there is nothing to gate.
        .filter((kind): kind is NonNullable<typeof kind> => Boolean(kind))
        .map((kind): AiConnectionKind =>
          kind === "platform" ? "platform" : "byok",
        ),
    ),
  ];
}

/** Channel-specific rendering of a caller-neutral admission refusal. */
function channelSpendBlockMessage(block: AiSpendBlock): string {
  if (block.reason === "budget") {
    return "This organization reached its daily AI budget, so teammates are not answering until the window resets.";
  }
  if (block.reason === "activation") {
    return "This organization is not active yet, so teammates cannot answer here.";
  }
  return block.detail;
}

/**
 * A marker in the transcript: the runtime speaking as itself, or, when the
 * marker is about one Teammate's turn, as that Teammate.
 *
 * The author is not decoration. A cap marker belongs to nobody, so it is
 * `system`; a turn that failed belongs to the Teammate that failed, and filing
 * it anywhere else would leave the chain's own record disagreeing with what it
 * spent.
 */
function appendMarker(
  input: ChannelChainInput,
  text: string,
  teammate?: Teammate,
): Promise<ChannelMessage> {
  return input.db.appendChannelMessage({
    organizationId: input.organizationId,
    channelId: input.channel.id,
    authorType: teammate ? "teammate" : "system",
    authorTeammateId: teammate?.id,
    content: [{ type: "text", action: "fallback", text }],
    chainId: input.startMessage.id,
  });
}

/**
 * One Teammate's turn in a channel, through the same engine a 1:1 turn runs.
 *
 * What differs from `streamConversationTurn` is the container, not the runtime:
 * the transcript is the channel's, so there is no Conversation to own the
 * messages, no session state to persist across turns and no Agent-memory
 * distillation (that reads a Conversation). What is identical is everything the
 * answer is made of: the persona layer, the Knowledge Scope search with its
 * Concept → Source citations, the granted action tools, and the memory layers.
 */
async function modelChannelTurn(
  input: ChannelChainInput,
  request: ChannelTurnRequest,
): Promise<ChannelTurnResult> {
  const { db, channel, organizationId } = input;
  const { teammate } = request;
  const turnStart = Date.now();
  const nameOf = nameResolver(input.roster);

  const [platformPrompt, actions, memoryDocuments] = await Promise.all([
    getRuntimeHost().getPlatformSystemPrompt(),
    input.teammateActions?.(teammate) ?? Promise.resolve([]),
    teammateMemorySections(db, {
      teammate,
      memberId: input.startedBy.userId,
      sharedProjectId: channel.projectId,
    }).catch((error) => {
      console.error("[channel] memory-document read failed:", error);
      return [] as string[];
    }),
  ]);

  const outcome = await executeTeammateAnswer({
      db,
      organizationId,
      teammate,
      connections: input.connections,
      conversationId: null,
      // The persona, plus what it cannot work out for itself: that this is a
      // group, who is in it, and that pulling in a colleague is not free.
      personaContext: channelPromptSection({
        channelName: channel.name,
        self: { id: teammate.id, name: teammate.name },
        roster: input.roster,
        startedByName: input.startedBy.name ?? null,
      }),
      turn: {
        platformPrompt,
        message: speakerLine(request.trigger, nameOf),
        // The transcript is read after the triggering message was persisted, so
        // the message this turn is answering is also the last thing in it.
        // Handing the model both would show it the same line twice, once as
        // history and once as the question.
        history: channelHistory(
          request.history.filter((message) => message.id !== request.trigger.id),
          teammate.id,
          nameOf,
        ),
        templateContext: buildTemplateContext({
          user: {
            name: input.startedBy.name ?? undefined,
            id: input.startedBy.userId,
          },
          message: messageText(request.trigger.content),
          history: [],
          metadata: {},
          conversationId: channel.id,
          appOrigin: platformAppOrigin(),
        }),
        teammateActions: actions,
        memoryDocuments,
        // No referral tool: in a channel, mentioning IS the referral, and it
        // reaches somebody who is already here (#773 was the 1:1 answer).
        session: createTurnSession(channel.id, {}),
        emit: request.emit,
        signal: request.signal,
      },
      forward: request.emit,
      telemetry: {
        assistantId: null,
        conversationId: null,
        surface: "teammate",
        startedAt: turnStart,
      },
      // Deliberately no keyResolution: see the module comment.
    });
  if (!outcome.ok) {
    await outcome.recordFailed();
    throw outcome.error;
  }
  return {
    parts: outcome.parts,
    trace: outcome.trace,
    usage: outcome.usageRows(null),
    recordSucceeded: (messageId) => outcome.recordSucceeded(messageId),
  };
}

/** id → display name, for the "who said this" prefixes the model reads. */
function nameResolver(
  roster: readonly ChannelRosterEntry[],
): (message: ChannelMessage) => string {
  const names = new Map(roster.map((entry) => [entry.id, entry.name]));
  return (message) => {
    if (message.authorType === "system") return "Channel";
    const id = message.authorUserId ?? message.authorTeammateId ?? "";
    return names.get(id) ?? "Someone";
  };
}

/** "Ada: what broke?", so a two-role chat API can carry a group thread. */
function speakerLine(
  message: ChannelMessage,
  nameOf: (message: ChannelMessage) => string,
): string {
  const text = messageText(message.content);
  return `${nameOf(message)}: ${text}`;
}

/**
 * The channel transcript as model history.
 *
 * A chat API has two roles and a channel has many speakers, so everything this
 * Teammate did not say is a `user` message prefixed with who said it, and its
 * own past messages are `assistant`. Without the prefix a model in a busy
 * channel answers whoever spoke last as though they were the only person there.
 */
function channelHistory(
  messages: readonly ChannelMessage[],
  selfId: string,
  nameOf: (message: ChannelMessage) => string,
): HistoryMessage[] {
  return messages.map((message) =>
    message.authorTeammateId === selfId
      ? { role: "assistant" as const, text: messageText(message.content) }
      : { role: "user" as const, text: speakerLine(message, nameOf) },
  );
}
