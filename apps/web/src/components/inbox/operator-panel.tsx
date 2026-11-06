"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationOperator, StoredMessage } from "@agent-hub/core";
import { effectiveOperatorState } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { Headphones } from "lucide-react";
import { toast } from "@/lib/toast";
import { RollInText } from "@/components/motion/roll-in-text";
import {
  readConversationLiveAction,
  releaseConversationAction,
  replyToConversationAction,
  takeOverConversationAction,
} from "@/app/(admin)/inbox/operator-actions";
import { LIVE_POLL_MS } from "@/lib/widget-live";
import { ReplyBox } from "@/components/inbox/reply-box";

/**
 * Answering a Visitor from the Inbox (#1082): Take over, a reply box while you
 * hold the Conversation, and Release. While the Conversation is held or
 * waiting it polls for what the Visitor writes, and hands new messages to the
 * transcript through `onMessages`.
 */
export function OperatorPanel({
  conversationId,
  canOperate,
  currentUserId,
  onMessages,
}: {
  conversationId: string;
  canOperate: boolean;
  currentUserId: string;
  onMessages: (messages: StoredMessage[]) => void;
}) {
  const [operator, setOperator] = useState<ConversationOperator | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = useRef(new Date().toISOString());
  const onMessagesRef = useRef(onMessages);
  useEffect(() => {
    onMessagesRef.current = onMessages;
  }, [onMessages]);

  const state = effectiveOperatorState(operator, new Date());
  const holdsIt = state === "held" && operator?.memberId === currentUserId;

  // A new Conversation starts its own cursor, a little in the past so a clock
  // ahead of the server's never skips a message; the transcript de-duplicates.
  useEffect(() => {
    cursor.current = new Date(Date.now() - 120_000).toISOString();
  }, [conversationId]);

  // First read, then a poll while somebody answers it or is awaited.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const result = await readConversationLiveAction(conversationId, cursor.current).catch(() => null);
      if (cancelled) return;
      if (result?.ok) {
        setOperator(result.value.operator ?? null);
        const latest = result.value.messages.at(-1)?.createdAt;
        if (latest) cursor.current = latest;
        if (result.value.messages.length > 0) onMessagesRef.current(result.value.messages);
        const live = effectiveOperatorState(result.value.operator, new Date());
        if (live !== "ai") timer = setTimeout(poll, LIVE_POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [conversationId, state]);

  async function takeOver() {
    setBusy(true);
    const result = await takeOverConversationAction(conversationId);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    setOperator(result.value.conversation.operator ?? null);
    onMessagesRef.current([result.value.line]);
  }

  async function release() {
    setBusy(true);
    const result = await releaseConversationAction(conversationId);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    setOperator(result.value.conversation.operator ?? null);
    onMessagesRef.current([result.value.line]);
  }

  async function send(text: string): Promise<boolean> {
    setBusy(true);
    const result = await replyToConversationAction(conversationId, text);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    onMessagesRef.current([result.value]);
    return true;
  }

  if (!operator) return null;

  return (
    <div className="bg-background sticky bottom-0 space-y-2 border-t px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Headphones className="text-muted-foreground size-4" aria-hidden />
        <span className="text-muted-foreground min-w-0 flex-1">
          <RollInText
            text={
              state === "held"
                ? holdsIt
                  ? "You are answering this conversation. The assistant is paused."
                  : `${operator.memberName ?? "A Member"} is answering this conversation.`
                : state === "waiting"
                  ? "The Visitor is waiting for a person."
                  : "The assistant is answering this conversation."
            }
          />
        </span>
        {canOperate && state !== "held" && (
          <Button variant="primary" size="sm" type="button" disabled={busy} onClick={() => void takeOver()}>
            Take over
          </Button>
        )}
        {canOperate && holdsIt && (
          <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void release()}>
            Release
          </Button>
        )}
      </div>
      {holdsIt && (
        <ReplyBox conversationId={conversationId} busy={busy} onSend={send} />
      )}
    </div>
  );
}
