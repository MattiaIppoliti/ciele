"use client";
import { ReactionRecord } from "@/components/chat/reaction-record";

import { useState, type ReactNode } from "react";
import type { ChatReplyPart, TurnView } from "@agent-hub/agent/client";
import type { FeedbackReactionId } from "@agent-hub/core";

/** The one variant the referral card renders (#773). */
export type TeammateReferralPart = Extract<
  ChatReplyPart,
  { type: "teammate_referral" }
>;
/** The Human review gate's card (#841). */
export type HumanReviewPart = Extract<ChatReplyPart, { type: "human_review" }>;
export type ActionApprovalPart = Extract<ChatReplyPart, { type: "action_approval" }>;
import { UserRoundPlus } from "lucide-react";
import { ToolApproval } from "@/components/agents/tool-approval";
import { HelpCircle, Radio, UserCheck } from "lucide-react";
import { ChatMarkdown, type InlineCitationRenderer } from "@/components/chat/chat-markdown";
import { FlowButtonIcon } from "@/components/chat/flow-button-icon";
import { ComponentReplyPart } from "@/components/chat/component-part";
import { ProgressLine } from "@/components/chat/progress-line";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { visibleReplyParts } from "@/components/chat/visible-reply-parts";
import { reviewDecisionLabel } from "@/lib/review-status";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "@/components/agents/message";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { EmojiFeedback } from "@/components/chat/emoji-feedback";
import { Citations } from "@/components/agents/citations";
import { toCitationItems } from "@/components/chat/citation-items";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { SpeechPlayback } from "@/components/chat/speech-playback";
import type { VoiceEndpoint } from "@/components/chat/voice-input-button";
import { showMessageTimeSeparator } from "./message-time-separator";
import { formatTime, sentAtLabel } from "@/lib/format";
import { CHAT_CARD } from "@/components/chat/chat-card";

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

function PartView({
  part,
  onSend,
  onOpenSupport,
  onAcceptReferral,
  acceptingReferral = false,
  onDecideReview,
  onDecideApproval,
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
  /** True while an accepted referral opens, so a second click cannot race it. */
  acceptingReferral?: boolean;
  onDecideReview?: (part: HumanReviewPart, decision: "approved" | "rejected") => void;
  onDecideApproval?: DecideApproval;
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
      <div className={`flex max-w-[90%] items-center gap-3 rounded-2xl px-3.5 py-3 ${CHAT_CARD}`}>
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
      <div className={`max-w-[90%] space-y-2 rounded-2xl px-3.5 py-3 ${CHAT_CARD}`}>
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
            disabled={acceptingReferral}
            className="text-primary text-sm font-semibold hover:underline disabled:opacity-50 disabled:hover:no-underline"
            onClick={() => onAcceptReferral(part)}
          >
            {acceptingReferral ? "Opening…" : `Continue with ${part.teammateName} →`}
          </button>
        )}
      </div>
    );
  }
  if (part.type === "webhook") {
    // The open callback gate (#842). Written once, when the gate opens; how it
    // closed arrives as the continuation's own parts, so this card never
    // changes state and needs no controls. Without it the transcript shows the
    // waiting sentence and then a gap, which reads as a turn that gave up.
    let host = part.subscribeUrl;
    try {
      host = new URL(part.subscribeUrl).host;
    } catch {
      /* a template that has not resolved; the raw string is still informative */
    }
    return (
      <div className={`max-w-[90%] space-y-2 rounded-2xl px-3.5 py-3 ${CHAT_CARD}`}>
        <div className="flex items-center gap-2">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
            <Radio className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Waiting on {host}</p>
            <p className="text-muted-foreground text-xs">
              {part.simulated ? "Simulated turn. " : ""}
              Until {formatTime(part.expiresAt)} UTC
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (part.type === "action_approval") {
    return <ApprovalCard part={part} onDecide={onDecideApproval} />;
  }
  if (part.type === "human_review") {
    const closed = part.status !== "pending";
    return (
      <div className={`max-w-[90%] space-y-2 rounded-2xl px-3.5 py-3 ${CHAT_CARD}`}>
        <div className="flex items-center gap-2">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
            <UserCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{part.title}</p>
            <p className="text-muted-foreground text-xs">
              {closed
                ? reviewDecisionLabel(part)
                : part.simulated
                  ? "Waiting for a decision (simulated, nothing was sent)"
                  : "Waiting for a colleague to decide"}
            </p>
          </div>
        </div>
        {!closed && part.simulated && onDecideReview && (
          <div className="flex gap-2">
            <button
              type="button"
              className="text-primary text-sm font-semibold hover:underline"
              onClick={() => onDecideReview(part, "approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className="text-muted-foreground text-sm font-semibold hover:underline"
              onClick={() => onDecideReview(part, "rejected")}
            >
              Reject
            </button>
          </div>
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
            loading="lazy"
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
 * Runs, or declines, an action the approval gate stopped (#958). Resolves true
 * once the decision landed, false when it did not and the card should reopen.
 */
type DecideApproval = (
  part: ActionApprovalPart,
  decision: "approved" | "rejected"
) => Promise<boolean>;

/**
 * The approval gate's card (#958). Deliberately the same shape as the Human
 * review card: to a Member, "something is waiting for you" is one thing,
 * whether a Flow paused or a colleague's action was stopped.
 *
 * The part carries no status, and a refresh does not rewrite the transcript the
 * client already holds, so the decision is remembered here. Without it both
 * buttons stayed live after the click and read as though nothing happened.
 */
function ApprovalCard({
  part,
  onDecide,
}: {
  part: ActionApprovalPart;
  onDecide?: DecideApproval;
}) {
  const [state, setState] = useState<"open" | "deciding" | "approved" | "rejected">("open");
  async function decide(decision: "approved" | "rejected") {
    if (!onDecide || state !== "open") return;
    setState("deciding");
    setState((await onDecide(part, decision)) ? decision : "open");
  }
  // The beui approval card. It never lists the call's arguments: the card
  // carries the catalogue's words and the reason, which is what the Member
  // agrees to (#958).
  return (
    <ToolApproval
      className="max-w-[90%]"
      title={part.title}
      tool={part.label}
      status={
        state === "deciding"
          ? "approving"
          : state === "approved"
            ? "approved"
            : state === "rejected"
              ? "denied"
              : "pending"
      }
      description={
        state === "approved"
          ? "You approved this action."
          : state === "rejected"
            ? "You declined this action."
            : undefined
      }
      onApprove={onDecide ? () => void decide("approved") : undefined}
      onDeny={onDecide ? () => void decide("rejected") : undefined}
    />
  );
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
  id?: string;
  threadParentId?: string | null;
  role: "user";
  text: string;
  /** Sent timestamp; older 1:1 transcripts may omit it. */
  sentAt: string | null;
  /** Set in a channel: which colleague sent it. */
  author?: ChatAuthor;
}
export interface ChatBotMsg extends TurnView {
  threadParentId?: string | null;
  role: "bot";
  sentAt?: string;
  /** Persisted message id, null while the turn is still streaming. */
  id: string | null;
  feedback: -1 | 0 | 1;
  feedbackReaction?: FeedbackReactionId | null;
  /** Set in a channel: which Teammate is answering. */
  author?: ChatAuthor;
}
/**
 * The runtime speaking as itself: today the chain-cap marker a channel keeps in
 * its transcript (#778). Rendered as a centred notice, because it is a fact
 * about the thread rather than something a participant said.
 */
export interface ChatNoticeMsg {
  id?: string;
  threadParentId?: string | null;
  role: "notice";
  sentAt?: string;
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
export function AuthorLine({ author, animated = false }: { author: ChatAuthor; animated?: boolean }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <GeneratedAvatar seed={author.avatarSeed} size="size-6" animated={animated} />
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
  /** Absent leaves reaction controls out: not every surface collects feedback. */
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
   * Decide a simulated Human review inline (#841): the Preview and the
   * Teammate chat pass one; the widget never sees a simulated request.
   */
  acceptingReferral,
  onDecideReview,
  onDecideApproval,
  /**
   * How a person's own words are drawn, when the surface knows something about
   * them that plain text cannot say. A channel passes a renderer that turns a
   * resolved `@name` into a chip (#778); the widget, the Preview and a 1:1
   * Teammate chat pass nothing, because in a two-party conversation there is
   * nobody to mention.
   */
  renderUserText,
  speechPlayback,
  renderCitation,
  showTimestamps = false,
  reactionChannelId,
  recordedReactions = [],
  presentation = "chat",
}: {
  presentation?: "chat" | "comment";
  showTimestamps?: boolean;
  reactionChannelId?: string;
  recordedReactions?: import("@agent-hub/core").MessageReaction[];
  messages: ChatMsg[];
  pending: boolean;
  onSend: (text: string) => void;
  onVote?: (msg: ChatBotMsg, reaction: FeedbackReactionId | null) => void;
  onOpenSupport?: (helpDeskId?: string) => void;
  hasPersistentSupport?: boolean;
  onAcceptReferral?: (part: TeammateReferralPart) => void;
  acceptingReferral?: boolean;
  onDecideReview?: (part: HumanReviewPart, decision: "approved" | "rejected") => void;
  onDecideApproval?: DecideApproval;
  renderUserText?: (text: string) => ReactNode;
  speechPlayback?: VoiceEndpoint;
  /** Preview can inspect Sources directly from the answer text. */
  renderCitation?: InlineCitationRenderer;
}) {
  return (
    <>
          {messages.flatMap((msg, i) => [
            showTimestamps && msg.sentAt && showMessageTimeSeparator(msg.sentAt, messages.slice(0, i).findLast((previous) => previous.sentAt)?.sentAt) ? (
              <div key={`date-${i}`} className="text-muted-foreground py-4 text-center text-xs">
                <time dateTime={msg.sentAt} suppressHydrationWarning>
                  {new Date(msg.sentAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </div>
            ) : null,
            msg.role === "notice" ? (
              <div key={i} className="flex items-center gap-2 py-1">
                <span className="bg-border h-px flex-1" />
                <span className="text-muted-foreground rounded-full border px-3 py-1 text-center text-xs">
                  {msg.text}
                </span>
                <span className="bg-border h-px flex-1" />
              </div>
            ) : msg.role === "user" ? (
              <Message key={i} from={presentation === "comment" ? "assistant" : "user"} animateIn={presentation === "chat"} className="group relative">
                <MessageContent>
                  {presentation === "chat" && msg.author && <AuthorLine author={msg.author} />}
                  {presentation === "comment" ? (
                    <div className="w-full text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {renderUserText ? renderUserText(msg.text) : msg.text}
                    </div>
                  ) : <MessageBubble>
                    <MessageBubbleContent className="max-w-[85%] text-primary-foreground whitespace-pre-wrap [overflow-wrap:anywhere] [&>span[aria-hidden]]:bg-primary">
                      {renderUserText ? renderUserText(msg.text) : msg.text}
                    </MessageBubbleContent>
                  </MessageBubble>}
                  {presentation === "chat" && msg.sentAt && (
                    <>
                      {/* Shown on hover or keyboard focus; the sr-only twin
                          carries it for a reader, who sees neither. */}
                      <span
                        aria-hidden="true"
                        suppressHydrationWarning
                        className="text-muted-foreground/80 pointer-events-none absolute right-1 -bottom-4 text-2xs whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                      >
                        {sentAtLabel(msg.sentAt)}
                      </span>
                      <span className="sr-only" suppressHydrationWarning>Sent {sentAtLabel(msg.sentAt)}</span>
                    </>
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
                const feedback = msg.feedbackReaction ?? null;
                const live = pending && i === messages.length - 1;
                return (
                  <Message key={i} from="assistant">
                    <MessageContent className="gap-2">
                      {presentation === "chat" && msg.author && <AuthorLine author={msg.author} animated />}
                      {/* Flows are deliberately invisible to chat users, routing
                          is audited in the Inbox transcript only. */}
                      <ThinkingPanel
                        steps={msg.steps}
                        phase={msg.phase}
                        searchCount={msg.searchCount}
                        active={live}
                      />
                      {parts.map((part, j) => {
                        if (part.type === "text") {
                          const isLast = j === lastTextIndex;
                          return (
                            <StreamingResponse
                              key={j}
                              status="complete"
                              reactionTarget={isLast && msg.id && (onVote || (reactionChannelId && presentation === "chat")) ? { messageId: msg.id, channelId: reactionChannelId } : undefined}
                              // The surrounding log already announces the
                              // turn; a second live region reads it twice.
                              announce={false}
                              copyText={part.text}
                              showActions={isLast && Boolean(msg.id)}
                              extraActions={isLast && speechPlayback && !live ? (
                                <SpeechPlayback {...speechPlayback} text={parts.filter((item) => item.type === "text").map((item) => item.text).join("\n\n")} />
                              ) : null}
                              // A surface that cannot store a vote does not
                              // offer one; copy and sources still stand.
                              showFeedback={Boolean(onVote)}
                              sources={isLast ? citationItems : []}
                              feedback={isLast ? feedback : null}
                              onFeedbackChange={
                                onVote
                                  ? (next) => onVote(msg, next)
                                  : undefined
                              }
                            >
                              <ChatMarkdown
                                text={part.text}
                                inlineSources={renderCitation ? citationItems : undefined}
                                renderCitation={renderCitation}
                              />
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
                            acceptingReferral={acceptingReferral}
                            onDecideReview={onDecideReview}
                            onDecideApproval={onDecideApproval}
                          />
                        );
                      })}
                      <ReactionRecord reactions={recordedReactions.filter((reaction) => reaction.messageId === msg.id)} />
                      {msg.streamingText !== null && (
                        <StreamingResponse status="streaming">
                          <ChatMarkdown
                            text={msg.streamingText}
                            inlineSources={renderCitation ? citationItems : undefined}
                            renderCitation={renderCitation}
                          />
                          <span aria-hidden="true" className="animate-pulse motion-reduce:animate-none">▍</span>
                        </StreamingResponse>
                      )}
                      {onVote && lastTextIndex === -1 && msg.id && parts.length > 0 && (
                        <EmojiFeedback
                          value={msg.feedbackReaction ?? null}
                          onChange={(reaction) => onVote(msg, reaction)}
                        />
                      )}
                    </MessageContent>
                  </Message>
                );
              })()
            )
          ])}
    </>
  );
}
