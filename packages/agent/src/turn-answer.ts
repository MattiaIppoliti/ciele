import { EMPTY_TURN_TRACE, consumeTurnStream, type TurnView } from "./stream";
import { streamConversationTurn, type ConversationTurnInput } from "./turn";
import type { ChatReplyPart } from "./types";

type SourcesPart = Extract<ChatReplyPart, { type: "sources" }>;
type TurnAnswerSource = SourcesPart["sources"][number];

/** One whole Conversation Turn, read back as a single answer. */
interface TurnAnswer {
  conversationId: string | null;
  /** The persisted bot message, null when the turn failed before one. */
  messageId: string | null;
  /** The Flow that handled the message, when one matched. */
  flowName: string | null;
  /** Every text part of the reply, in order, joined by a blank line. */
  answer: string;
  /** The Concept → Source citations, each once, in the order first cited. */
  sources: TurnAnswerSource[];
  /** The runtime's error message when the turn failed; the answer is then its fallback. */
  error: string | null;
}

/**
 * A Conversation Turn for a caller that cannot read a stream: an API key
 * asking an Assistant a question and holding the socket for the answer.
 *
 * Deliberately the real turn, not a second pipeline: `streamConversationTurn`
 * runs, persists and meters exactly as for the widget, and the stream is
 * folded by `consumeTurnStream`, the one fold the widget, the Preview and the
 * Inbox already share, so this answer is by construction the one they would
 * have rendered. What differs is only who reads it.
 */
export async function answerConversationTurn(input: ConversationTurnInput): Promise<TurnAnswer> {
  const body = await streamConversationTurn(input);
  let view: TurnView = { ...EMPTY_TURN_TRACE, parts: [], streamingText: null };
  let conversationId: string | null = null;
  let messageId: string | null = null;
  let error: string | null = null;
  await consumeTurnStream(body, {
    update: (fn) => {
      view = fn(view);
    },
    onStart: (start) => {
      conversationId = start.conversationId;
    },
    onDone: (done) => {
      conversationId = done.conversationId;
      messageId = done.messageId;
    },
    onEvent: (event) => {
      if (event.type === "error") error = event.message;
    },
  });

  const parts = view.parts;
  const answer = parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
  const seen = new Set<string>();
  const sources: TurnAnswerSource[] = [];
  for (const part of parts) {
    if (part.type !== "sources") continue;
    for (const source of part.sources) {
      const key = `${source.conceptId ?? ""}\n${source.sourceId ?? ""}\n${source.conceptTitle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }
  return {
    conversationId,
    messageId,
    flowName: view.flowName,
    answer,
    sources,
    error,
  };
}
