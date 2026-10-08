"use client";

import { Button as CieleButton } from "@agent-hub/ui";
import { EmptyState } from "@/components/ui/empty-state";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, CornerDownRight, X } from "lucide-react";
import { ReactionRecord } from "@/components/chat/reaction-record";
import type { MessageReaction } from "@agent-hub/core";
import type { ChatModelOption } from "@agent-hub/agent/client";
import { ChatThread, type ChatMsg } from "@/components/chat/chat-thread";
import { MessageReactions } from "@/components/chat/message-reactions";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { GroupComposer } from "./group-composer";
import { groupMessageThreads } from "@/lib/teammates/group-threads";
import type { MentionTarget } from "@/lib/teammates/mention";
import { sentAtLabel } from "@/lib/format";
import { RollingNumber } from "@/components/motion/rolling-number";
import styles from "./group-thread.module.css";

export function GroupThread({ messages, pending, channelId, targets, models, teammateId, onSend, renderText, readOnly = false, recordedReactions = [] }: {
  readOnly?: boolean;
  recordedReactions?: MessageReaction[];
  messages: ChatMsg[];
  pending: boolean;
  channelId: string;
  targets: MentionTarget[];
  models: ChatModelOption[];
  teammateId?: string;
  onSend: (text: string, model?: string, attachments?: string[], replyToId?: string) => Promise<boolean>;
  renderText: (text: string) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [replying, setReplying] = useState<string | null>(null);
  const threads = groupMessageThreads(messages);
  if (threads.length === 0 && !pending) return <EmptyState size="sm" title="No messages yet"  />;
  return <ol className={styles.list} aria-label="Group messages">
    {threads.map((thread) => {
      const expanded = !collapsed.has(thread.key);
      const reply = () => {
        setReplying(thread.key);
        setCollapsed((previous) => { const next = new Set(previous); next.delete(thread.key); return next; });
      };
      const row = (message: ChatMsg, live: boolean) => {
        if (message.role === "notice") return <ChatThread messages={[message]} pending={false} onSend={onSend} presentation="comment" />;
        const name = message.author?.name ?? (message.role === "bot" ? "Teammate" : "A colleague");
        return <article className={styles.comment} aria-label={`${name} message`} data-slot="group-comment" data-author-kind={message.role}>
          <GeneratedAvatar seed={message.author?.avatarSeed ?? "unknown"} size="size-7" animated={message.role === "bot"} />
          <div className={styles.main}>
            <header className={styles.meta}>
              <span className={styles.name}>{name}</span>
              {message.role === "bot" && <span className="text-muted-foreground text-xs">AI</span>}
              {message.sentAt && <time className={styles.time} dateTime={message.sentAt} suppressHydrationWarning>{sentAtLabel(message.sentAt)}</time>}
            </header>
            <div className={styles.body}>
              <ChatThread messages={[message]} pending={live} onSend={(text) => void onSend(text, undefined, undefined, thread.root.id ?? undefined)} presentation="comment" renderUserText={renderText} />
            </div>
            <div className={styles.footer}>
              {readOnly ? <ReactionRecord reactions={recordedReactions.filter((reaction) => reaction.messageId === message.id)} /> : message.id ? <MessageReactions target={{messageId:message.id,channelId}} presentation="comment">
                <CieleButton variant="ghost" size="sm" type="button" className={`${styles.action} press-text`} onClick={reply} disabled={pending || !thread.root.id}><CornerDownRight className="size-3.5" />Reply</CieleButton>
              </MessageReactions> : null}
            </div>
          </div>
        </article>;
      };
      return <li key={thread.key} data-slot="group-thread">
        {row(thread.root, pending && thread.root === messages.at(-1))}
        {thread.replies.length > 0 && <div className="ml-12">
          <button type="button" className={`${styles.toggle} press-text`} aria-expanded={expanded} aria-controls={`replies-${thread.key}`} onClick={() => setCollapsed((previous) => {
            const next = new Set(previous); if (next.has(thread.key)) next.delete(thread.key); else next.add(thread.key); return next;
          })}>
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {expanded ? "Hide replies" : <><RollingNumber value={thread.replies.length} /> {thread.replies.length === 1 ? "reply" : "replies"}</>}
          </button>
        </div>}
        {expanded && thread.replies.length > 0 && <ol id={`replies-${thread.key}`} className={styles.replies} aria-label="Thread replies">
          {thread.replies.map((message, index) => <li key={message.id ?? `stream-${index}`}>{row(message, pending && message === messages.at(-1))}</li>)}
        </ol>}
        {replying === thread.key && <div className={styles.composer} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); setReplying(null); } }}>
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Reply in thread</span>
            <CieleButton variant="ghost" size="icon-sm" type="button" aria-label="Cancel reply" className={`${styles.action} press-control`} onClick={() => setReplying(null)}><X className="size-3.5" /></CieleButton>
          </div>
          <GroupComposer autoFocus targets={targets} models={models} teammateId={teammateId} pending={pending} placeholder="Reply… Use @ to ask a teammate" aria-label="Reply in thread"
            onSubmit={async (text, model, attachments) => {
              if (!thread.root.id) return false;
              return onSend(text, model, attachments, thread.root.id);
            }} />
        </div>}
      </li>;
    })}
  </ol>;
}
