"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { feedbackReactionScore, type ConversationMetadata, type FeedbackReactionId, type Teammate } from "@agent-hub/core";
import { isCieleAi } from "@agent-hub/core";
import { threadEntryLabel } from "@/lib/teammates/thread-label";
import { EMPTY_TURN_TRACE } from "@agent-hub/agent/client";
import type { ChatModelOption } from "@agent-hub/agent/client";
import { playFeedback } from "@agent-hub/ui/feedback";
import { chatMessagesFromStored } from "@/components/chat/stored-messages";
import { chatFeedbackForEvent } from "@/lib/chat-feedback";
import { DraftingCompass, UserRoundPlus } from "lucide-react";
import { Paperclip, X } from "lucide-react";
import Link from "next/link";
import { ChatSurface } from "@/components/chat/rail-panel";
import { ChatHeader } from "@/components/chat/chat-header";
import { FULLSCREEN_GUTTER, WIDEN_TRANSITION } from "@/components/chat/fullscreen-motion";
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
import { AUTO_MODEL } from "@/lib/teammates/auto-model";
import { toPromptModels } from "@/components/chat/use-chat-models";
import {
  useComposerTrigger,
  replaceToken,
} from "@/components/chat/use-composer-trigger";
import {
  TriggerList,
  TriggerRow,
  triggerInputProps,
} from "@/components/chat/trigger-list";
import { useAttachments } from "@/components/chat/use-attachments";
import {
  AttachmentChips,
  AttachmentDropHint,
  AttachmentInput,
} from "@/components/chat/attachment-chips";
import { readChatAttachmentAction } from "@/app/actions";
import { createChannelAction } from "@/app/(admin)/teammates/channels/actions";
import { ThreadHistoryMenu } from "@/components/teammates/thread-history-menu";
import { toast } from "@/lib/toast";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { EyeTracker } from "@/components/teammates/eye-tracker";
import {
  readTeammateConversationAction,
  setTeammateMessageFeedbackAction,
  decideActionApprovalAction,
  startReferredConversationAction,
} from "@/app/(admin)/teammates/actions";
import { liveTurnStatus } from "@/components/chat/stored-trace";
import { patchLastBot, runTurn } from "@/components/chat/turn-session";
import { chatSession } from "@/lib/chat-session";

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
  retired,
  models,
  autoModel = false,
  personalSubscriptionsAllowed,
  channelCandidates,
  skills,
}: {
  teammate: Teammate;
  thread: ThreadEntry[];
  /** Soft-deleted: the transcripts are here, the composer is not (#767). */
  retired: boolean;
  /** The picker's rows; empty when this Teammate offers no choice. */
  models: ChatModelOption[];
  /**
   * "Auto", the picker's first row and its default: the latest Eval's best
   * model, resolved by the chat route on every send. False draws no Auto row.
   */
  autoModel?: boolean;
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
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState(false);
  // The picker's standing choice for this session; see `models` above.
  const [model, setModel] = useState<string | undefined>();
  const promptModels = toPromptModels(models, autoModel);
  // Controlled only because `@` edits it from outside the input.
  const [draft, setDraft] = useState("");
  /**
   * The Teammate a Ciele AI message is addressed to, from `@`: a tag in the
   * composer, not a navigation. The Member keeps typing, and sending is what
   * moves the question, and the page, to that Teammate.
   */
  const [addressee, setAddressee] = useState<{ id: string; name: string } | null>(null);
  // A question Ciele AI handed over, read once on mount and sent below.
  const [handedQuestion] = useState(() => readHandedQuestion(teammate.id));
  const sentHandedQuestion = useRef(false);
  // Ciele AI, the Organization's AI layer, rather than a Teammate.
  const platformLayer = isCieleAi(teammate);
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
  const skillListId = useId();
  const channelListId = useId();
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
            icon: <DraftingCompass />,
          },
        ]
      : []),
    ...(channelCandidates.length > 0
      ? [
          {
            value: "teammate",
            label: platformLayer ? "Ask a teammate" : "Bring in a teammate",
            description: platformLayer
              ? "Tags them: your message goes to them."
              : "Opens a group with both of them.",
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
      if (platformLayer) setAddressee({ id: candidate.id, name: candidate.name });
      else void openChannelWith(candidate);
    },
  });

  /**
   * From Ciele AI, a message tagged `@Sam` is a question for Sam: sending it
   * opens Sam's chat and asks it there. Not a group, as between two Teammates:
   * Ciele AI acts as the Member rather than with grants, and a channel has no
   * single Member for it to act as, so it is never seated in one. The question
   * travels in sessionStorage, never in the URL, so it stays out of the
   * browser's history.
   */
  function askTeammate(target: { id: string }, text: string) {
    try {
      window.sessionStorage.setItem(questionHandoffKey(target.id), text);
    } catch {
      // Private mode: the chat still opens, and the question has to be asked again.
    }
    router.push(`/teammates/${target.id}`);
  }

  // Ask the question Ciele AI handed over, once. The key is cleared here, not
  // while rendering, and the ref keeps a second effect pass from asking twice.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(questionHandoffKey(teammate.id));
    } catch {
      // Nothing to clear.
    }
    if (handedQuestion && !sentHandedQuestion.current) {
      sentHandedQuestion.current = true;
      void send(handedQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teammate.id]);

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
  // Which thread is open lives in the tab's chat session, because the shell's
  // New chat and ⌘O change it from above this tree.
  const { conversationId, resets } = useSyncExternalStore(
    chatSession.subscribe,
    chatSession.getSnapshot,
    chatSession.getSnapshot
  );
  /**
   * The open conversation's metadata, kept for the referrals it records (#773).
   * Without it the origin transcript is the one place that cannot say where the
   * handoff went, which makes a referral look like it never happened.
   */
  const [conversationMeta, setConversationMeta] =
    useState<ConversationMetadata | null>(null);
  const [, startTransition] = useTransition();
  // Its own transition, so the card can stay disabled until the navigation
  // to the colleague's chat lands.
  const [acceptingReferral, startReferral] = useTransition();

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
   * Follow `?c=` as the address bar has it, not as the server rendered it.
   *
   * The URL is the one shared handle on "which thread is open": the sidebar's
   * history links set it, the sidebar's New chat clears it, and the effect
   * below writes it whenever this chat opens or starts a thread on its own.
   * Reading the server's prop instead missed every change `replaceState` made,
   * so New chat right after a first message found a URL the page had never
   * seen, and nothing reset. Comparing against the open thread is what keeps
   * the chat's own writes from echoing back into a reopen.
   */
  const urlConversationId = useSearchParams().get("c");

  // The session holds a New chat asked mid-answer until the answer ends, so
  // it needs to know when one is running; and nothing is open once this chat
  // unmounts, or the next Teammate's chat would continue this thread.
  useEffect(() => chatSession.setBusy(pending), [pending]);
  useEffect(() => () => chatSession.close(), []);

  // A reset from anywhere (New chat here, in the sidebar, ⌘O, or the thread
  // leaving the URL) clears the transcript.
  const clearAttachments = attachments.clear;
  const seenResets = useRef(resets);
  useEffect(() => {
    if (resets === seenResets.current) return;
    seenResets.current = resets;
    clearAttachments();
    setConversationMeta(null);
    setMessages([]);
    setHistoryOpen(false);
  }, [resets, clearAttachments]);

  const openFromUrl = useEffectEvent((id: string) => void openConversation(id));
  useEffect(() => {
    const id = chatSession.followUrl(urlConversationId);
    if (id) openFromUrl(id);
  }, [urlConversationId]);

  /**
   * Mirror the open thread into `?c=` without a navigation, so the sidebar
   * can highlight it and a reload lands on it. `replaceState` is picked up by
   * the App Router's `useSearchParams` and never reaches the server, so the
   * `?c=` prop above only moves on a real navigation.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get("c") ?? null) === conversationId) return;
    if (conversationId) url.searchParams.set("c", conversationId);
    else url.searchParams.delete("c");
    // `null`, never the current state: Next only syncs `useSearchParams` for a
    // state it did not write itself.
    window.history.replaceState(null, "", url.toString());
  }, [conversationId]);

  const updateLastBot = (fn: (bot: ChatBotMsg) => ChatBotMsg) =>
    setMessages((prev) => patchLastBot(prev, fn));

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    playFeedback("send");
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
      const outcome = await runTurn<ChatBotMsg>({
        request: (signal, turnId) =>
          fetch(`/api/teammates/${teammate.id}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: chatSession.getSnapshot().conversationId,
              message,
              turnId,
              // Nothing picked means Auto when the picker offers it.
              model: model ?? (autoModel ? AUTO_MODEL : null),
              attachments: attachments.tokens,
            }),
            signal,
          }),
        update: updateLastBot,
        onStart: ({ conversationId: started }) => {
          // A new thread is titled by its first message, the rule the runtime
          // applies when it creates one; an existing one keeps its title.
          const existing = thread.find((entry) => entry.id === started);
          chatSession.started({
            id: started,
            teammateId: teammate.id,
            title: existing?.title ?? message.slice(0, 80),
            updatedAt: new Date().toISOString(),
            metadata: existing?.metadata ?? null,
          });
        },
        onDone: ({ conversationId: done }) => chatSession.opened(done),
        onEvent: (event) => {
          const cue = chatFeedbackForEvent(event);
          if (cue) playFeedback(cue);
        },
        errorText: (text) => `⚠️ ${text}`,
      });
      if (outcome.status === "failed") toast.error(outcome.error.message);
    } finally {
      setPending(false);
    }
  }

  async function vote(bot: ChatBotMsg, reaction: FeedbackReactionId | null) {
    if (!bot.id) return;
    const nextReaction = bot.feedbackReaction === reaction ? null : reaction;
    const feedback = feedbackReactionScore(nextReaction);
    const patch = (next: Pick<ChatBotMsg, "feedback" | "feedbackReaction">) =>
      setMessages((prev) =>
        prev.map((m) => (m.role === "bot" && m.id === bot.id ? { ...m, ...next } : m))
      );
    patch({ feedback, feedbackReaction: nextReaction });
    try {
      await setTeammateMessageFeedbackAction(teammate.id, bot.id, nextReaction);
    } catch {
      // Put the reaction back: a highlight that was never stored is a lie.
      patch({ feedback: bot.feedback, feedbackReaction: bot.feedbackReaction ?? null });
      toast.error("Could not save your reaction");
    }
  }

  // Switching conversation mid-turn would let the running stream's `onDone`
  // write the old id back, and the "new" chat would continue the old one.
  function newChat() {
    if (pending) return;
    chatSession.requestNewChat();
  }

  async function openConversation(id: string) {
    if (pending) return;
    try {
      const { messages: stored, conversation } =
        await readTeammateConversationAction(teammate.id, id);
      attachments.clear();
      chatSession.opened(id);
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
  async function decideApproval(
    part: ActionApprovalPart,
    decision: "approved" | "rejected"
  ): Promise<boolean> {
    try {
      await decideActionApprovalAction({ id: part.approvalId, decision });
      // Either way the decision landed, which is the outcome worth a cue.
      playFeedback("success");
      startTransition(() => router.refresh());
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not decide that action"
      );
      return false;
    }
  }

  function acceptReferral(part: TeammateReferralPart) {
    if (!conversationId || acceptingReferral) return;
    startReferral(async () => {
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

  // Every chat opens the same way until its first message: the face, the
  // question and the composer in the middle of the page (Notion's). Only the
  // face changes between Ciele AI and a Teammate.
  const heroEmpty = messages.length === 0 && !fullscreen;

  return (
    <div data-eye-tracker-frame className="flex h-full flex-col overflow-hidden">
      {/* No header bar above the chat: the Teammate's name is in the chat's
          own header, and Configure is its right-click menu in the sidebar. */}

      {/* The chat is a card on a page, the shape the Assistant Preview already
          has: a bordered surface with room around it, not a column bleeding
          into the chrome. While full screen animates, the card is out of flow,
          so the spacer holds its slot and is what the collapse measures back
          down to. */}
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 sm:px-5">
        <ChatSurface
          fullscreen={fullscreen}
          animating={animating}
          spacerRef={spacerRef}
          surfaceRef={surfaceRef}
          framed={!heroEmpty}
        >
        {/* The widget's own header component, so a Teammate chat and a Visitor
            chat get the same controls in the same places, full screen
            included. */}
        {!heroEmpty && (
        <ChatHeader
          nickname={teammate.name}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen(!historyOpen)}
          historyMenu={
            <ThreadHistoryMenu
              entries={thread.map((entry) => ({
                id: entry.id,
                label: threadEntryLabel(entry),
                updatedAt: entry.updatedAt,
              }))}
              activeId={conversationId}
              disabled={pending}
              onPick={(id) => void openConversation(id)}
            />
          }
          onNewChat={newChat}
          busy={pending}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
        />
        )}

        <>
            {heroEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-end gap-4 px-4 pb-6 text-center">
                {platformLayer ? (
                  <EyeTracker shape="Ciele" size={64} follow={24} bounce={0} />
                ) : (
                  <TeammateAvatar teammate={teammate} className="size-16" />
                )}
                <h1 className="text-3xl font-bold tracking-tight">What can I do for you?</h1>
              </div>
            ) : (
            <MessageScroller
              className="min-h-0 flex-1"
              busy={pending}
              status={liveTurnStatus(messages, pending)}
              navigation="rail"
              viewportClassName={`py-5 ${WIDEN_TRANSITION} ${
                fullscreen ? FULLSCREEN_GUTTER : "px-4"
              }`}
              contentClassName="space-y-4"
            >
              <ChatThread
                messages={messages}
                pending={pending}
                onSend={send}
                onVote={vote}
                onAcceptReferral={acceptReferral}
                acceptingReferral={acceptingReferral}
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
            )}

            <div
              className={`${WIDEN_TRANSITION} ${
                fullscreen
                  ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6"
                  : "px-4 pb-4"
              }`}
            >
              {retired ? (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-center text-sm">
                  <RollInText text={teammate.name} /> was deleted. Your conversations with it stay
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
                {addressee && (
                  <div className="mb-2 flex">
                    <span className="bg-foreground/[0.12] text-foreground inline-flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-sm font-medium">
                      @{addressee.name}
                      <button
                        type="button"
                        aria-label={`Stop asking ${addressee.name}`}
                        onClick={() => setAddressee(null)}
                        className="press-control text-muted-foreground hover:bg-foreground/10 hover:text-foreground flex size-5 items-center justify-center rounded-full"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </div>
                )}
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
                      id={skillListId}
                      label="Use a skill"
                      items={skillTrigger.matches}
                      highlighted={skillTrigger.highlighted}
                      onHighlight={skillTrigger.setHighlighted}
                      onPick={skillTrigger.pick}
                      renderItem={(skill) => (
                        <TriggerRow
                          name={skill.name}
                          hint={skill.description || skill.starter}
                          icon={<DraftingCompass />}
                        />
                      )}
                    />
                  )}
                  {channelTrigger.open && (
                    <TriggerList
                      id={channelListId}
                      label="Bring in another teammate"
                      items={channelTrigger.matches}
                      highlighted={channelTrigger.highlighted}
                      onHighlight={channelTrigger.setHighlighted}
                      onPick={channelTrigger.pick}
                      renderItem={(candidate) => (
                        <TriggerRow
                          name={candidate.name}
                          hint={
                            candidate.title ||
                            (platformLayer ? "Your message goes to them" : "Opens a group with both")
                          }
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
                    // While a turn streams the composer refuses to submit, so
                    // Enter keeps the draft instead of clearing it for a
                    // `send` that would return early and drop it.
                    loading={pending}
                    {...(channelTrigger.open
                      ? triggerInputProps(channelListId, true, channelTrigger.highlighted)
                      : triggerInputProps(skillListId, skillTrigger.open, skillTrigger.highlighted))}
                    onSubmit={(value) => {
                      // See the widget: a file mid-read would vanish.
                      if (attachments.busy || pending) return;
                      setDraft("");
                      channelTrigger.reset();
                      skillTrigger.reset();
                      if (addressee) {
                        if (!value.trim()) return;
                        setAddressee(null);
                        askTeammate(addressee, value.trim());
                        return;
                      }
                      void send(value);
                    }}
                    onSelect={(event) => {
                      channelTrigger.sync(event.currentTarget.value);
                      skillTrigger.sync(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      // Backspace at the start of an empty box takes the tag off.
                      if (event.key === "Backspace" && addressee && !event.currentTarget.value) {
                        setAddressee(null);
                      }
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
                    models={promptModels}
                    // What answers when nothing is picked: the first model a
                    // connection serves, else the configured one's row.
                    model={
                      model ??
                      (autoModel ? AUTO_MODEL : undefined) ??
                      models.find((option) => !option.unavailable)?.selector ??
                      models[0]?.selector
                    }
                    onModelChange={setModel}
                    minRows={1}
                    maxRows={6}
                    placeholder={`Ask ${addressee?.name ?? teammate.name}…`}
                    aria-label={`Ask ${addressee?.name ?? teammate.name}`}
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
            {/* Below the composer, the other half of the centring. */}
            {heroEmpty && <div className="flex-1" />}
        </>
        </ChatSurface>
      </div>
    </div>
  );
}

/** Where Ciele AI leaves the question it hands to a Teammate. */
function questionHandoffKey(teammateId: string): string {
  return `teammate-question:${teammateId}`;
}

function readHandedQuestion(teammateId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(questionHandoffKey(teammateId)) ?? "";
  } catch {
    return "";
  }
}
