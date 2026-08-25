import type {
  ChannelMessage,
  ChannelRosterEntry,
  Teammate,
} from "@agent-hub/core";
import type { ChatReplyPart } from "@agent-hub/agent/client";
import { EMPTY_TURN_TRACE } from "@agent-hub/agent/client";
import type { ChatAuthor, ChatMsg } from "@/components/chat/chat-thread";
import { visibleTraceSteps } from "@/components/chat/stored-trace";

/**
 * A stored channel message as the shared transcript renders it (#778).
 *
 * The renderer was shared from the start, `ChatThread` draws the channel and the
 * Owner's read-only oversight view alike, but the mapping onto it was written
 * twice, so the two surfaces could disagree about who said something while
 * agreeing about how to draw it. They now differ only in what they wrap the
 * transcript in.
 *
 * Plain TS, no JSX: this app's vitest picks up `.test.ts` only, so the author
 * fallbacks and the trace gate are testable exactly because they live here and
 * not in either component.
 */

/** Everyone a channel message can be attributed to, and what its reader may see. */
export interface ChannelCast {
  roster: readonly ChannelRosterEntry[];
  /** Only the four fields a bubble's header shows, so a test needs no persona. */
  teammates: readonly Pick<
    Teammate,
    "id" | "name" | "title" | "avatarSeed"
  >[];
  /** Admins and above see the model's own reasoning in a stored trace (#557). */
  canViewReasoning: boolean;
}

/**
 * A Teammate can be deleted while its messages stay in the transcript, which is
 * the point of an append-only thread. Name the absence rather than dropping the
 * bubble: the reply happened, and a nameless one reads as a bug.
 */
const DELETED_TEAMMATE = "A deleted teammate";
/** A Member who has left the roster; the message is still theirs. */
const FORMER_MEMBER = "A colleague";
/** A face is still drawn when the id it would be seeded from is gone. */
const UNSEEDED = "unknown";

/**
 * The name and face above a Teammate's bubble.
 *
 * Also used live, where the stream names the speaker before the roster lookup
 * can fail, hence `fallbackName`: mid-chain a Teammate is not deleted, it is
 * simply not in the array this client was rendered with.
 */
export function teammateAuthor(
  teammate: Pick<Teammate, "name" | "title" | "avatarSeed"> | undefined,
  teammateId: string | null,
  fallbackName: string = DELETED_TEAMMATE
): ChatAuthor {
  return {
    name: teammate?.name ?? fallbackName,
    title: teammate?.title || undefined,
    avatarSeed: teammate?.avatarSeed?.trim() || teammateId || UNSEEDED,
  };
}

/** The text of a message's reply parts, for the surfaces that render a line. */
export function channelMessageText(content: readonly unknown[]): string {
  return (content as ChatReplyPart[])
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** A whole stored transcript, in order, ready for `ChatThread`. */
export function channelChatMessages(
  messages: readonly ChannelMessage[],
  cast: ChannelCast
): ChatMsg[] {
  const names = new Map(cast.roster.map((entry) => [entry.id, entry.name]));
  const teammateById = new Map(cast.teammates.map((t) => [t.id, t]));

  return messages.map((message) => {
    if (message.authorType === "system") {
      // Nobody was speaking: a cap marker or a failed turn is a fact about the
      // thread, not somebody's bubble.
      return { role: "notice", text: channelMessageText(message.content) };
    }
    if (message.authorType === "member") {
      return {
        role: "user",
        text: channelMessageText(message.content),
        // Null for anything read back from storage, as in the 1:1 transcript:
        // the hover timestamp is formatted with the *reader's* locale and
        // timezone, so rendering a stored one server-side mismatches on
        // hydration. It shows for messages sent in this session, which are
        // client-only.
        sentAt: null,
        author: {
          name: names.get(message.authorUserId ?? "") ?? FORMER_MEMBER,
          avatarSeed: message.authorUserId ?? UNSEEDED,
        },
      };
    }
    // The stored trace, so a channel read back keeps the Thinking panel it had
    // live: the transcript is the audit (#778, story 17), and a reader who
    // scrolls up should still see which tools ran.
    const trace = visibleTraceSteps(message.trace, {
      canViewReasoning: cast.canViewReasoning,
    });
    return {
      role: "bot",
      id: message.id,
      ...EMPTY_TURN_TRACE,
      steps: trace?.steps ?? [],
      searchCount: trace?.searchCount ?? 0,
      phase: "done",
      parts: message.content as ChatReplyPart[],
      streamingText: null,
      feedback: 0,
      author: teammateAuthor(
        message.authorTeammateId
          ? teammateById.get(message.authorTeammateId)
          : undefined,
        message.authorTeammateId
      ),
    };
  });
}
