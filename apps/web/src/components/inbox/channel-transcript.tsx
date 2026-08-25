"use client";

import type {
  ChannelMessage,
  ChannelRosterEntry,
  Teammate,
} from "@agent-hub/core";
import { ChatThread } from "@/components/chat/chat-thread";
import { channelChatMessages } from "@/lib/teammates/channel-messages";

/**
 * A channel transcript with nothing to type into (#778, story 15).
 *
 * The same renderer the channel itself uses, so an Owner reading a thread they
 * were not in sees exactly what the people in it saw: the tool cards, the
 * Thinking panels and the Concept → Source citations, in the same order. A
 * second renderer for oversight would be a second thing to keep true.
 */
export function ChannelTranscript({
  messages,
  roster,
  teammates,
  canViewReasoning,
}: {
  messages: ChannelMessage[];
  roster: ChannelRosterEntry[];
  teammates: Teammate[];
  /** Admins and above see the model's own reasoning in the trace (#557). */
  canViewReasoning: boolean;
}) {
  // The same mapping the channel itself runs, so the two surfaces cannot
  // disagree about who said what (`lib/teammates/channel-messages.ts`).
  const rendered = channelChatMessages(messages, {
    roster,
    teammates,
    canViewReasoning,
  });

  if (rendered.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Nothing has been said in this group yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Read-only: `onSend` is what the follow-up chips and quick replies would
          call, and there is nothing to send from here. */}
      <ChatThread messages={rendered} pending={false} onSend={() => {}} />
    </div>
  );
}
