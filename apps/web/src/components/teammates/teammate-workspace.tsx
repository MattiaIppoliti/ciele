"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { feedbackReactionScore, type ConversationMetadata, type FeedbackReactionId, type Teammate } from "@agent-hub/core";
import { teammateSearchesKnowledge } from "@agent-hub/core";
import { threadEntryLabel } from "@/lib/teammates/thread-label";
import { EMPTY_TURN_TRACE, consumeTurnStream } from "@agent-hub/agent/client";
import type { ChatModelOption } from "@agent-hub/agent/client";
import { playFeedback } from "@agent-hub/ui/feedback";
import { chatMessagesFromStored } from "@/components/chat/stored-messages";
import { chatFeedbackForEvent } from "@/lib/chat-feedback";
import { Sparkles, UserRoundPlus } from "lucide-react";
import { ArrowLeft, Paperclip, Settings2 } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import Link from "next/link";
import { ChatHeader } from "@/components/chat/chat-header";
import { WIDEN_TRANSITION } from "@/components/chat/fullscreen-motion";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import {
  ChatThread,
  type ActionApprovalPart,
  type TeammateReferralPart,
  type ChatBotMsg,
  type ChatMsg,
} from "@/components/chat/chat-thread";
import { MessageScroller } from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { toPromptModels } from "@/components/chat/use-chat-models";
import {
  useComposerTrigger,
  replaceToken,
} from "@/components/chat/use-composer-trigger";
import { TriggerList, TriggerRow } from "@/components/chat/trigger-list";
import { useAttachments } from "@/components/chat/use-attachments";
import {
  AttachmentChips,
  AttachmentDropHint,
  AttachmentInput,
} from "@/components/chat/attachment-chips";
import { readChatAttachmentAction } from "@/app/actions";
import { createChannelAction } from "@/app/(admin)/teammates/channels/actions";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { toast } from "@/lib/toast";
import { setMessageFeedbackAction } from "@/app/actions";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import {
  readTeammateConversationAction,
  decideActionApprovalAction,
  startReferredConversationAction,
} from "@/app/(admin)/teammates/actions";

export interface ThreadEntry {
  id: string;
  title: string;
  updatedAt: string;
  /** Carries the Routine marker, when the run was unattended (#772). */
  metadata?: ConversationMetadata | null;
}

/**
 * The Teammate chat: the Preview's chat, retitled (#767).
 *
 * Everything visible here is the component the Assistant's Preview and the
 * published widget already use, the `ChatHeader`, the `ChatThread` transcript
 * with its Thinking panel and Concept → Source citations, the `PromptInput`
 * composer, over the same `streamConversationTurn` ndjson stream. What it drops
 * is what belongs to a public widget and to nobody else: the welcome card, the
 * SSO gate, escalation, proactive triggers, the launcher.
 */
export function TeammateWorkspace({
  teammate,
  thread,
  canEdit,
  retired,
  initialConversationId,
  models,
  personalSubscriptionsAllowed,
  channelCandidates,
  skills,
}: {
  teammate: Teammate;
  thread: ThreadEntry[];
  /** Whether Configure is offered; the route itself enforces the same rule. */
  canEdit: boolean;
  /** Soft-deleted: the transcripts are here, the composer is not (#767). */
  retired: boolean;
  /** The picker's rows; empty when this Teammate offers no choice. */
  models: ChatModelOption[];
  /**
   * Whether the Organization allows Members' own subscriptions at all. When it
   * does, one that is connected outranks this picker (ADR-0007 as amended by
   * #769), and the composer says so rather than looking broken.
   */
  personalSubscriptionsAllowed: boolean;
  /**
   * Who `@` can name here: the other Teammates this Member can see. Naming one
   * opens a channel rather than sending a word, because a 1:1 Conversation is
   * single-subject by construction (#778) and a second colleague in it would
   * need a roster the Inbox, Insights and every export would then have to ask
   * about.
   */
  channelCandidates: Array<{ id: string; name: string; title: string }>;
  /** Organization Skills that carry an opening line, for the `/` menu. */
  skills: Array<{
    id: string;
    name: string;
    description: string;
    starter: string;
  }>;
  /**
   * A Conversation to open on arrival, from `?c=`. This is how a referral
   * lands: the target's chat has to open the conversation carrying the summary,
   * not a blank one beside it (#773).
   */
  initialConversationId: string | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState(false);
  // The picker's standing choice for this session; see `models` above.
  const [model, setModel] = useState<string | undefined>();
  // Controlled only because `@` edits it from outside the input.
  const [draft, setDraft] = useState("");
  const [openingChannel, setOpeningChannel] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const composerTextarea = () =>
    composerRef.current?.querySelector("textarea") ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachments = useAttachments(async (file) => {
    const body = new FormData();
    body.set("file", file);
    body.set("teammateId", teammate.id);
    return readChatAttachmentAction(body);
  });

  const skillTrigger = useComposerTrigger({
    trigger: "/",
    items: skills,
    textarea: composerTextarea,
    onPick: (skill, token) => {
      const element = composerTextarea();
      const caret = element ? element.selectionStart : draft.length;
      const next = replaceToken(draft, token, caret, skill.starter);
      setDraft(next.text);
      skillTrigger.settle(next.caret);
    },
  });
  const composerActions = [
    {
      value: "attach",
      label: "Attach a file",
      description: "A document, a spreadsheet or a screenshot.",
      icon: <Paperclip />,
      disabled: attachments.full,
    },
    ...(skills.length > 0
      ? [
          {
            value: "skill",
            label: "Use a skill",
            description: "Start from a prepared request.",
            icon: <Sparkles />,
          },
        ]
      : []),
    ...(channelCandidates.length > 0
      ? [
          {
            value: "teammate",
            label: "Bring in a teammate",
            description: "Opens a group with both of them.",
            icon: <UserRoundPlus />,
          },
        ]
      : []),
  ];
  const channelTrigger = useComposerTrigger({
    trigger: "@",
    items: channelCandidates,
    textarea: composerTextarea,
    onPick: (candidate, token) => {
      const element = composerTextarea();
      const caret = element ? element.selectionStart : draft.length;
      // The `@` is a command, not a word: it leaves the draft, and whatever
      // was being typed around it survives into the new thread's composer.
      const next = replaceToken(draft, token, caret, "");
      setDraft(next.text);
      channelTrigger.settle(next.caret);
      void openChannelWith(candidate);
    },
  });

  /**
   * Promotes this 1:1 to a group: one channel, this Teammate and the named one,
   * with the Member seated by `createChannelOp` itself.
   *
   * Nothing is copied across. The Conversation stays where it is and stays
   * readable; a channel is its own entity with its own messages, and moving a
   * transcript into one would be inventing a history that never happened there.
   */
  async function openChannelWith(candidate: { id: string; name: string }) {
    if (openingChannel) return;
    setOpeningChannel(true);
    try {
      const channel = await createChannelAction({
        name: `${teammate.name} & ${candidate.name}`,
        teammateIds: [teammate.id, candidate.id],
      });
      router.push(`/teammates/channels/${channel.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not open a group"
      );
      setOpeningChannel(false);
    }
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Full screen, on the same FLIP the Assistant Preview and the embed host use:
   * the chat card grows out of the flow to `fixed inset-0` rather than snapping
   * (see `use-fullscreen-grow`). A Teammate chat is a chat card on a page, the
   * same as a Preview, so it expands the same way and by the same control in
   * the shared `ChatHeader`.
   */
  const { fullscreen, setFullscreen, surfaceRef, animating, spacerRef } =
    useFullscreenGrow();
  const [conversationId, setConversationId] = useState<string | null>(null);
  /**
   * The open conversation's metadata, kept for the referrals it records (#773).
   * Without it the origin transcript is the one place that cannot say where the
   * handoff went, which makes a referral look like it never happened.
   */
  const [conversationMeta, setConversationMeta] =
    useState<ConversationMetadata | null>(null);
  const [, startTransition] = useTransition();
  const conversationRef = useRef<string | null>(null);

  // A newly-started conversation only reaches the history list on a refresh.
  useEffect(() => {
    if (!historyOpen) return;
    startTransition(() => router.refresh());
  }, [historyOpen, router]);

  // Escape leaves full screen, the standard overlay convention and the same
  // key the Preview answers.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen]);

  /**
   * Open the Conversation named by `?c=`, once.
   *
   * The ref guard, rather than a dependency list, because opening sets state
   * this effect would otherwise react to, and because re-opening would throw
   * away whatever the Member has typed since.
   */
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (!initialConversationId || openedFromUrl.current) return;
    openedFromUrl.current = true;
    void openConversation(initialConversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  const updateLastBot = (fn: (bot: ChatBotMsg) => ChatBotMsg) =>
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "bot") next[next.length - 1] = fn(last);
      return next;
    });

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    playFeedback("send");
    const turnId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { role: "user", text: message, sentAt: new Date().toISOString() },
      {
        role: "bot",
        id: null,
        ...EMPTY_TURN_TRACE,
        parts: [],
        streamingText: null,
        feedback: 0,
      },
    ]);

    try {
      const response = await fetch(`/api/teammates/${teammate.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationRef.current,
          message,
          turnId,
          model: model ?? null,
          attachments: attachments.tokens,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Chat failed (${response.status})`);
      }
      await consumeTurnStream<ChatBotMsg>(response.body, {
        update: updateLastBot,
        onStart: ({ conversationId: started }) => {
          conversationRef.current = started;
          setConversationId(started);
        },
        onDone: ({ conversationId: done, messageId }) => {
          conversationRef.current = done;
          setConversationId(done);
          updateLastBot((bot) => ({ ...bot, id: messageId }));
        },
        onEvent: (event) => {
          const cue = chatFeedbackForEvent(event);
          if (cue) playFeedback(cue);
        },
        errorText: (text) => `⚠️ ${text}`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chat failed");
    } finally {
      setPending(false);
    }
  }

  async function vote(bot: ChatBotMsg, reaction: FeedbackReactionId | null) {
    if (!bot.id) return;
    const nextReaction = bot.feedbackReaction === reaction ? null : reaction;
    const feedback = feedbackReactionScore(nextReaction);
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "bot" && m.id === bot.id
          ? { ...m, feedback, feedbackReaction: nextReaction }
          : m
      )
    );
    await setMessageFeedbackAction(bot.id, feedback, nextReaction);
  }

  function newChat() {
    conversationRef.current = null;
    setConversationId(null);
    setConversationMeta(null);
    setMessages([]);
    setHistoryOpen(false);
  }

  async function openConversation(id: string) {
    try {
      const { messages: stored, conversation } =
        await readTeammateConversationAction(teammate.id, id);
      conversationRef.current = id;
      setConversationId(id);
      setConversationMeta(conversation.metadata ?? null);
      setMessages(chatMessagesFromStored(stored));
      setHistoryOpen(false);
    } catch {
      toast.error("Could not open that conversation");
    }
  }

  /**
   * Accept a referral card (#773): open the colleague it names, carrying the
   * summary the referring Teammate wrote.
   *
   * Navigating to the new conversation rather than swapping it in place, so
   * the origin transcript stays where it was: the handoff is a second thread,
   * not a continuation that erases the first.
   */
  /**
   * The approval gate's card (#958). The Member is already looking at the
   * conversation the action was stopped in, so the decision is taken here
   * rather than on a page of its own: the context that makes it answerable is
   * the transcript above it.
   */
  function decideApproval(
    part: ActionApprovalPart,
    decision: "approved" | "rejected"
  ) {
    startTransition(async () => {
      try {
        await decideActionApprovalAction({ id: part.approvalId, decision });
        // Either way the decision landed, which is the outcome worth a cue.
        playFeedback("success");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not decide that action"
        );
      }
    });
  }

  function acceptReferral(part: TeammateReferralPart) {
    if (!conversationId) return;
    startTransition(async () => {
      try {
        const { conversationId: opened } = await startReferredConversationAction({
          originConversationId: conversationId,
          teammateId: part.teammateId,
          summary: part.summary,
        });
        // The handoff went through: an outcome, so the outcome's cue (#817).
        playFeedback("success");
        router.push(`/teammates/${part.teammateId}?c=${opened}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not open that chat"
        );
      }
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Link
          href="/teammates"
          /* The way back, for the widths where the rail is not on screen.
             Above `lg` it is, and a back link to a list you can already see is
             just noise in the header. */
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm lg:hidden"
        >
          <ArrowLeft className="size-4" />
          Teammates
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <TeammateAvatar teammate={teammate} className="size-8 text-xs" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{teammate.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {teammate.title || "AI teammate"}
            </p>
          </div>
        </div>
        {canEdit && (
          <Hint label="Persona, knowledge and visibility">
            {/* One configuration surface, not two. This used to open a drawer
                over the chat holding the same form `/teammates/{id}/settings`
                renders, which meant two ways to reach one thing that had to be
                kept looking alike, and the drawer made this route load the
                whole settings payload on every chat open to fill a panel
                almost nobody opened. */}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              render={<Link href={`/teammates/${teammate.id}/settings`} />}
            >
              <Settings2 className="size-4" /> Configure
            </Button>
          </Hint>
        )}
      </div>

      {/* The chat is a card on a page, the shape the Assistant Preview already
          has: a bordered surface with room around it, not a column bleeding
          into the chrome. While full screen animates, the card is out of flow,
          so the spacer holds its slot and is what the collapse measures back
          down to. */}
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 sm:px-5">
        {animating && <div ref={spacerRef} className="min-h-0 flex-1" />}
        <div
          ref={surfaceRef}
          className={
            fullscreen
              ? "bg-card fixed inset-0 z-50 flex flex-col overflow-hidden"
              : "bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border"
          }
        >
        {/* The widget's own header component, so a Teammate chat and a Visitor
            chat get the same controls in the same places, full screen
            included. */}
        <ChatHeader
          nickname={teammate.name}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen(!historyOpen)}
          onNewChat={newChat}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
        />

        {historyOpen ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4">
              <span className="text-primary border-primary inline-block border-b-2 px-1 pt-3 pb-2 text-sm font-semibold">
                My conversations
              </span>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-2 py-2">
              {thread.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  No conversations with {teammate.name} yet
                </p>
              ) : (
                <AISidebar
                  items={thread.map(
                    (entry): SidebarResource => ({
                      id: entry.id,
                      label: threadEntryLabel(entry),
                      kind: "file",
                    })
                  )}
                  activeId={conversationId}
                  onActiveChange={(id) => void openConversation(id)}
                />
              )}
            </div>
          </div>
        ) : (
          <>
            <MessageScroller
              className="min-h-0 flex-1"
              busy={pending}
              navigation="rail"
              viewportClassName={`py-5 ${WIDEN_TRANSITION} ${
                fullscreen ? "px-[max(1.5rem,calc((100%-56rem)/2))]" : "px-4"
              }`}
              contentClassName="space-y-4"
            >
              {messages.length === 0 && (
                <div className="pt-10 text-center">
                  <TeammateAvatar
                    teammate={teammate}
                    className="size-12"
                  />
                  <p className="mt-4 text-lg font-semibold">{teammate.name}</p>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {teammate.roleDescription ||
                      "No standing role yet. Configure one so this teammate knows what it is for."}
                  </p>
                  {/* Both halves of the scope, through the one predicate the
                      runtime uses to decide whether to register a search tool
                      at all: a Teammate scoped to two files searches. */}
                  {!teammateSearchesKnowledge(teammate) && (
                    <p className="text-muted-foreground mt-3 text-xs">
                      No knowledge in scope: it answers from its role and says
                      so when a question needs a source.
                    </p>
                  )}
                </div>
              )}
              <ChatThread
                messages={messages}
                pending={pending}
                onSend={send}
                onVote={vote}
                onAcceptReferral={acceptReferral}
                onDecideApproval={decideApproval}
              />
              {/* Where a referral from this conversation went (#773). The
                  handoff is two threads on purpose, so the origin has to say
                  which one continued it; otherwise the click leads somewhere
                  the Member can only find again by hunting the other
                  Teammate's history. */}
              {conversationMeta?.referredTo?.length ? (
                <div className="mt-4 space-y-1 border-t pt-3">
                  <p className="text-muted-foreground text-xs font-medium">
                    Continued with
                  </p>
                  {conversationMeta.referredTo.map((referral) => (
                    <Link
                      key={referral.conversationId}
                      href={`/teammates/${referral.teammateId}?c=${referral.conversationId}`}
                      className="text-primary flex items-center gap-1.5 text-sm hover:underline"
                    >
                      <UserRoundPlus className="size-3.5" />
                      {referral.teammateName}
                    </Link>
                  ))}
                </div>
              ) : null}
            </MessageScroller>

            <div
              className={`${WIDEN_TRANSITION} ${
                fullscreen
                  ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6"
                  : "px-4 pb-4"
              }`}
            >
              {retired ? (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-center text-sm">
                  {teammate.name} was deleted. Your conversations with it stay
                  readable, and it answers nothing more.
                </p>
              ) : (
                <>
                <AttachmentInput
                  inputRef={fileInputRef}
                  accept={attachments.accept}
                  onPick={(file) => void attachments.attach(file)}
                />
                <AttachmentChips
                  entries={attachments.entries}
                  onRemove={attachments.remove}
                />
                <div
                  className="relative"
                  ref={composerRef}
                  {...attachments.dropProps}
                >
                  {attachments.dragging && (
                    <AttachmentDropHint label="Drop to attach" />
                  )}
                  {skillTrigger.open && (
                    <TriggerList
                      label="Use a skill"
                      items={skillTrigger.matches}
                      highlighted={skillTrigger.highlighted}
                      onHighlight={skillTrigger.setHighlighted}
                      onPick={skillTrigger.pick}
                      renderItem={(skill) => (
                        <TriggerRow
                          name={skill.name}
                          hint={skill.description || skill.starter}
                          icon={<Sparkles />}
                        />
                      )}
                    />
                  )}
                  {channelTrigger.open && (
                    <TriggerList
                      label="Bring in another teammate"
                      items={channelTrigger.matches}
                      highlighted={channelTrigger.highlighted}
                      onHighlight={channelTrigger.setHighlighted}
                      onPick={channelTrigger.pick}
                      renderItem={(candidate) => (
                        <TriggerRow
                          name={candidate.name}
                          hint={candidate.title || "Opens a group with both"}
                          icon={<UserRoundPlus />}
                        />
                      )}
                    />
                  )}
                  <PromptInput
                    value={draft}
                    onValueChange={(value) => {
                      setDraft(value);
                      channelTrigger.sync(value);
                      skillTrigger.sync(value);
                    }}
                    onSubmit={(value) => {
                      // See the widget: a file mid-read would vanish.
                      if (attachments.busy) return;
                      setDraft("");
                      channelTrigger.reset();
                      skillTrigger.reset();
                      void send(value);
                    }}
                    onSelect={(event) => {
                      channelTrigger.sync(event.currentTarget.value);
                      skillTrigger.sync(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      channelTrigger.handleKeyDown(event);
                      skillTrigger.handleKeyDown(event);
                    }}
                    onBlur={() => {
                      channelTrigger.close();
                      skillTrigger.close();
                    }}
                    onPaste={attachments.onPaste}
                    actions={composerActions}
                    onAction={(action) => {
                      if (action === "attach") {
                        fileInputRef.current?.click();
                      } else if (action === "skill") {
                        skillTrigger.openFromButton(draft, setDraft);
                      } else if (action === "teammate") {
                        channelTrigger.openFromButton(draft, setDraft);
                      }
                    }}
                    models={toPromptModels(models)}
                    model={model ?? models[0]?.selector}
                    onModelChange={setModel}
                    minRows={1}
                    maxRows={6}
                    placeholder={`Ask ${teammate.name}...`}
                    aria-label={`Ask ${teammate.name}`}
                  />
                </div>
                </>
              )}
              {!retired && models.length > 0 && personalSubscriptionsAllowed && (
                <p className="text-muted-foreground mt-2 text-xs">
                  A personal AI subscription connected in Settings → AI answers
                  your turns instead, whichever model is picked here.
                </p>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
