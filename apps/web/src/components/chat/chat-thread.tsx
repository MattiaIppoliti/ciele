"use client";

import type { ReactNode } from "react";
import type { ChatReplyPart, TurnView } from "@agent-hub/agent/client";

/** The one variant the referral card renders (#773). */
export type TeammateReferralPart = Extract<
  ChatReplyPart,
  { type: "teammate_referral" }
>;
import { HelpCircle, ThumbsDown, ThumbsUp, UserRoundPlus } from "lucide-react";
import { Hint } from "@agent-hub/ui";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { FlowButtonIcon } from "@/components/chat/flow-button-icon";
import { ComponentReplyPart } from "@/components/chat/component-part";
import { ProgressLine } from "@/components/chat/progress-line";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { visibleReplyParts } from "@/components/chat/visible-reply-parts";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "@/components/agents/message";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { Citations, type CitationItem } from "@/components/agents/citations";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";

/**
 * The chat transcript, shared by the console's two chat surfaces (#768): the
 * Assistant's live Preview and the Teammate chat.
 *
 * It was the Preview panel's inline render until the Teammate chat needed the
 * same thing: same bubbles, same Thinking panel, same Concept → Source
 * citations, same reply-part vocabulary. One renderer means a new part type or
 * a citation fix lands on both at once.
 *
 * The published widget (`widget/widget-chat.tsx`) still carries its own copy of
 * the part cascade. Folding it on is the obvious next step and deliberately not
 * this ticket's: that code serves anonymous Visitors on customer sites, and it
 * deserves its own change with its own verification.
 *
 * Each surface keeps what is genuinely its own: the header, the composer, the
 * escalation panel, history.
 */

type SourcesPart = Extract<ChatReplyPart, { type: "sources" }>;

/** Concept→Source citations, shaped for the beui citation components. */
function toCitationItems(sources: SourcesPart["sources"]): CitationItem[] {
  return sources.map((source, index) => ({
    id: source.conceptId ?? `source-${index}`,
    title: source.conceptTitle,
    domain: source.sourceName
      ? `${source.collectionName} · ${source.sourceName}`
      : source.collectionName,
    url: source.url ?? undefined,
  }));
}

/** "07 Jul, 14:32", the hover timestamp on a sent message. */
function sentAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

function PartView({
  part,
  onSend,
  onOpenSupport,
  onAcceptReferral,
}: {
  part: ChatReplyPart;
  onSend: (text: string) => void;
  onOpenSupport: (helpDeskId?: string) => void;
  /**
   * Opens the colleague a referral card names (#773). Absent on the Assistant
   * Preview, which shares this renderer and has no Teammates to refer to; the
   * card then renders without its button rather than with a dead one.
   */
  onAcceptReferral?: (part: TeammateReferralPart) => void;
}) {
  // `text` and `sources` parts are rendered by the message body itself (a
  // beui StreamingResponse with the sources disclosure folded in), not here.
  if (part.type === "progress") {
    return <ProgressLine text={part.text} />;
  }
  if (part.type === "notification") {
    return (
      <div className="bg-muted/60 max-w-[90%] space-y-1 rounded-2xl rounded-tl-sm border-l-2 px-3.5 py-2.5 text-sm">
        {part.title && <p className="font-medium">{part.title}</p>}
        <ChatMarkdown text={part.content} />
      </div>
    );
  }
  if (part.type === "help_desk") {
    return (
      <div className="flex max-w-[90%] items-center gap-3 rounded-2xl border px-3.5 py-3">
        {part.showIcon !== false && (
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
            <FlowButtonIcon icon={part.icon} className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Need more help?</p>
          <button
            type="button"
            className="text-primary text-sm font-semibold hover:underline"
            onClick={() => onOpenSupport(part.helpDeskId)}
          >
            {part.label}
          </button>
        </div>
      </div>
    );
  }
  if (part.type === "teammate_referral") {
    return (
      <div className="max-w-[90%] space-y-2 rounded-2xl border px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
            <UserRoundPlus className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Ask {part.teammateName}</p>
            {part.reason && (
              <p className="text-muted-foreground text-xs">{part.reason}</p>
            )}
          </div>
        </div>
        {/* The summary is shown, not hidden behind the button: the Member is
            about to send it to a colleague, so they get to read it first. */}
        {part.summary && (
          <p className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-xs">
            {part.summary}
          </p>
        )}
        {onAcceptReferral && (
          <button
            type="button"
            className="text-primary text-sm font-semibold hover:underline"
            onClick={() => onAcceptReferral(part)}
          >
            Continue with {part.teammateName} →
          </button>
        )}
      </div>
    );
  }
  if (part.type === "clarify") {
    return (
      <div className="bg-muted/40 max-w-[90%] rounded-2xl rounded-tl-sm border border-dashed px-3.5 py-2.5 text-sm">
        <div className="text-muted-foreground flex items-center gap-1.5">
          <HelpCircle className="size-4" />
          <span className="text-xs font-medium">Quick question first</span>
        </div>
        <p className="mt-1.5">{part.question}</p>
        {part.found && part.found.length > 0 && (
          <div className="text-muted-foreground mt-2 text-xs">
            <span>Here&apos;s what I did find:</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {part.found.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (part.type === "button") {
    if (part.buttonType === "send_text" || part.buttonType === "faq") {
      return (
        <button
          type="button"
          onClick={() => onSend(part.text ?? "")}
          className="bg-primary text-primary-foreground inline-flex max-w-[90%] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
        >
          {part.label}
          {part.showIcon !== false && (
            <FlowButtonIcon icon={part.icon} className="size-3.5" />
          )}
        </button>
      );
    }
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-primary text-primary-foreground inline-flex max-w-[90%] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
      >
        {part.label}
        {part.showIcon !== false && (
          <FlowButtonIcon icon={part.icon} className="size-3.5" />
        )}
      </a>
    );
  }
  if (part.type === "iframe") {
    const iframeTitle = part.title?.trim() || "Embedded content";
    return (
      <div className="max-w-[90%]">
        {part.title && (
          <p className="mb-1.5 text-sm font-medium">{iframeTitle}</p>
        )}
        <div className="overflow-hidden rounded-2xl border">
          <iframe
            src={part.url}
            title={iframeTitle}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="w-full"
            style={{ height: `${part.height ?? 30}${part.heightUnit ?? "vh"}` }}
          />
        </div>
      </div>
    );
  }
  if (part.type === "component") {
    // A reply that carries a component, streamed as the model writes it. It
    // arrived on `main` inside the Preview's own part renderer; the Preview now
    // delegates to this component (#767, one chat surface), so it lives here
    // and the Teammate chat gets it too.
    return <ComponentReplyPart part={part} onAsk={onSend} />;
  }
  if (part.type === "follow_ups") {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        {part.questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSend(q)}
            className="border-primary/30 text-primary hover:bg-primary/5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    );
  }
  return null;
}

/**
 * Who wrote a message, when the surface has more than one possible author.
 *
 * Absent in a 1:1 chat, where "the visitor" and "the assistant" are the whole
 * cast and a name above every bubble would be noise. Present in a channel
 * (#778), where following a thread means knowing which colleague said what.
 */
export interface ChatAuthor {
  name: string;
  /** Their standing role or title, shown small beside the name. */
  title?: string;
  /** Seed for the generated face, so one author looks the same everywhere. */
  avatarSeed: string;
}

export interface ChatUserMsg {
  role: "user";
  text: string;
  /** Hover timestamp; null when the message was read back from storage. */
  sentAt: string | null;
  /** Set in a channel: which colleague sent it. */
  author?: ChatAuthor;
}
export interface ChatBotMsg extends TurnView {
  role: "bot";
  /** Persisted message id, null while the turn is still streaming. */
  id: string | null;
  feedback: -1 | 0 | 1;
  /** Set in a channel: which Teammate is answering. */
  author?: ChatAuthor;
}
/**
 * The runtime speaking as itself: today the chain-cap marker a channel keeps in
 * its transcript (#778). Rendered as a centred notice, because it is a fact
 * about the thread rather than something a participant said.
 */
export interface ChatNoticeMsg {
  role: "notice";
  text: string;
}
export type ChatMsg = ChatUserMsg | ChatBotMsg | ChatNoticeMsg;

/**
 * The name (and face) above a bubble, in a thread with several authors.
 *
 * Exported so the marketing Teammate shot draws the real identity line rather
 * than a lookalike: that shot's whole claim is "this is a colleague", and the
 * face and name are what carry it.
 */
export function AuthorLine({ author }: { author: ChatAuthor }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <GeneratedAvatar seed={author.avatarSeed} size="size-6" />
      <span className="text-sm font-semibold">{author.name}</span>
      {author.title && (
        <span className="text-muted-foreground text-xs">{author.title}</span>
      )}
    </div>
  );
}


export function ChatThread({
  messages,
  pending,
  onSend,
  /** Absent leaves the 👍/👎 controls out: not every surface collects feedback. */
  onVote,
  /** Absent means the surface has no escalation panel to open. */
  onOpenSupport,
  /**
   * True when the surface shows a persistent "contact support" button, which
   * is what makes an inline help-desk part a duplicate rather than the offer.
   */
  hasPersistentSupport = false,
  /**
   * Opens the colleague a referral card names (#773). Absent on the Assistant
   * Preview, which shares this renderer and has nobody to refer to; the card
   * then renders without a button rather than with a dead one.
   */
  onAcceptReferral,
  /**
   * How a person's own words are drawn, when the surface knows something about
   * them that plain text cannot say. A channel passes a renderer that turns a
   * resolved `@name` into a chip (#778); the widget, the Preview and a 1:1
   * Teammate chat pass nothing, because in a two-party conversation there is
   * nobody to mention.
   */
  renderUserText,
}: {
  messages: ChatMsg[];
  pending: boolean;
  onSend: (text: string) => void;
  onVote?: (msg: ChatBotMsg, feedback: 1 | -1) => void;
  onOpenSupport?: (helpDeskId?: string) => void;
  hasPersistentSupport?: boolean;
  onAcceptReferral?: (part: TeammateReferralPart) => void;
  renderUserText?: (text: string) => ReactNode;
}) {
  return (
    <>
          {messages.map((msg, i) =>
            msg.role === "notice" ? (
              <div key={i} className="flex items-center gap-2 py-1">
                <span className="bg-border h-px flex-1" />
                <span className="text-muted-foreground rounded-full border px-3 py-1 text-center text-xs">
                  {msg.text}
                </span>
                <span className="bg-border h-px flex-1" />
              </div>
            ) : msg.role === "user" ? (
              <Message key={i} from="user" animateIn className="group relative">
                <MessageContent>
                  {msg.author && <AuthorLine author={msg.author} />}
                  <MessageBubble>
                    <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
                      {renderUserText ? renderUserText(msg.text) : msg.text}
                    </MessageBubbleContent>
                  </MessageBubble>
                  {msg.sentAt && (
                    <span className="text-muted-foreground/80 pointer-events-none absolute right-1 -bottom-4 text-2xs whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      {sentAtLabel(msg.sentAt)}
                    </span>
                  )}
                </MessageContent>
              </Message>
            ) : (
              (() => {
                const parts = visibleReplyParts(msg.parts, hasPersistentSupport);
                const lastTextIndex = parts.reduce(
                  (acc, part, index) => (part.type === "text" ? index : acc),
                  -1
                );
                const citationItems = toCitationItems(
                  parts.flatMap((part) =>
                    part.type === "sources" ? part.sources : []
                  )
                );
                const feedback =
                  msg.feedback === 1 ? "up" : msg.feedback === -1 ? "down" : null;
                return (
                  <Message key={i} from="assistant">
                    <MessageContent className="gap-2">
                      {msg.author && <AuthorLine author={msg.author} />}
                      {/* Flows are deliberately invisible to chat users, routing
                          is audited in the Inbox transcript only. */}
                      <ThinkingPanel
                        steps={msg.steps}
                        phase={msg.phase}
                        searchCount={msg.searchCount}
                        active={pending && i === messages.length - 1}
                      />
                      {parts.map((part, j) => {
                        if (part.type === "text") {
                          const isLast = j === lastTextIndex;
                          return (
                            <StreamingResponse
                              key={j}
                              status="complete"
                              copyText={part.text}
                              showActions={isLast && Boolean(msg.id)}
                              // A surface that cannot store a vote does not
                              // offer one; copy and sources still stand.
                              showFeedback={Boolean(onVote)}
                              sources={isLast ? citationItems : []}
                              feedback={isLast ? feedback : null}
                              onFeedbackChange={
                                onVote
                                  ? (next) => {
                                      if (next === "up") onVote(msg, 1);
                                      else if (next === "down") onVote(msg, -1);
                                      // Clearing = re-voting the active value.
                                      else onVote(msg, msg.feedback === 1 ? 1 : -1);
                                    }
                                  : undefined
                              }
                            >
                              <ChatMarkdown text={part.text} />
                            </StreamingResponse>
                          );
                        }
                        if (part.type === "sources") {
                          if (lastTextIndex !== -1) return null;
                          return (
                            <Citations
                              key={j}
                              citations={toCitationItems(part.sources)}
                              className="max-w-[90%]"
                            />
                          );
                        }
                        return (
                          <PartView
                            key={j}
                            part={part}
                            onSend={onSend}
                            onOpenSupport={onOpenSupport ?? (() => {})}
                            onAcceptReferral={onAcceptReferral}
                          />
                        );
                      })}
                      {msg.streamingText !== null && (
                        <StreamingResponse status="streaming">
                          <ChatMarkdown text={msg.streamingText} />
                          <span className="animate-pulse">▍</span>
                        </StreamingResponse>
                      )}
                      {onVote && lastTextIndex === -1 && msg.id && parts.length > 0 && (
                        <div className="flex gap-1">
                          <Hint label="Good response">
                            <button
                              type="button"
                              aria-label="Good response"
                              onClick={() => onVote(msg, 1)}
                              className={`rounded p-1 transition-colors ${msg.feedback === 1 ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              <ThumbsUp className="size-3.5" />
                            </button>
                          </Hint>
                          <Hint label="Bad response">
                            <button
                              type="button"
                              aria-label="Bad response"
                              onClick={() => onVote(msg, -1)}
                              className={`rounded p-1 transition-colors ${msg.feedback === -1 ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              <ThumbsDown className="size-3.5" />
                            </button>
                          </Hint>
                        </div>
                      )}
                    </MessageContent>
                  </Message>
                );
              })()
            )
          )}
    </>
  );
}
