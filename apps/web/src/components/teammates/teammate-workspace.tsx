"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ConversationMetadata,
  Teammate,
  TeammateRoutine,
} from "@agent-hub/core";
import { teammateSearchesKnowledge } from "@agent-hub/core";
import { threadEntryLabel } from "@/lib/teammates/thread-label";
import type { ChatReplyPart } from "@agent-hub/agent/client";
import { EMPTY_TURN_TRACE, consumeTurnStream } from "@agent-hub/agent/client";
import { playFeedback } from "@agent-hub/ui/feedback";
import { chatFeedbackForEvent } from "@/lib/chat-feedback";
import { ArrowLeft, Settings2, UserRoundPlus } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import Link from "next/link";
import { ChatHeader } from "@/components/chat/chat-header";
import { WIDEN_TRANSITION } from "@/components/chat/fullscreen-motion";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import {
  ChatThread,
  type TeammateReferralPart,
  type ChatBotMsg,
  type ChatMsg,
} from "@/components/chat/chat-thread";
import { MessageScroller } from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { toast } from "@/lib/toast";
import { setMessageFeedbackAction } from "@/app/actions";
import type { MemberOption } from "@/components/teammates/teammate-editors-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { TeammateSettingsDrawer } from "@/components/teammates/teammate-settings-drawer";
import type { TeammateGovernanceState } from "@/components/teammates/teammate-grants-picker";
import {
  readTeammateConversationAction,
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
  collections,
  sources,
  sourcesTruncated,
  members,
  thread,
  canEdit,
  governance,
  canGrant,
  projects,
  learnings,
  routines,
  retired,
  initialConversationId,
}: {
  teammate: Teammate;
  collections: CollectionOption[];
  /** The Library items its Knowledge Scope can name one at a time (PRD #726). */
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  members: MemberOption[];
  thread: ThreadEntry[];
  canEdit: boolean;
  /** What this Teammate was granted (#770), read from its grant rows. */
  governance: TeammateGovernanceState;
  /** Whether this Member may change that. Admin only. */
  canGrant: boolean;
  /** Live Projects it can attach to (#771). */
  projects: { id: string; name: string }[];
  /** Its Agent memory layer, editable in the dialog. */
  learnings: string;
  /** Its standing instructions (#772). */
  routines: TeammateRoutine[];
  /** Soft-deleted: the transcripts are here, the composer is not (#767). */
  retired: boolean;
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
  /**
   * The settings drawer mounts only while this is true, so every open is a
   * fresh mount seeded from the props as they stand at that click. The props
   * move between opens: opening history refreshes the route, and the drawer's
   * Server Actions revalidate it after a save. A colleague can be editing the
   * same Teammate.
   * Nothing is lost by unmounting, because a closed drawer holds no draft
   * anybody meant to keep. The Agent memory layer needs more than this and
   * reads itself on open; see the drawer.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  async function vote(bot: ChatBotMsg, value: -1 | 1) {
    if (!bot.id) return;
    const feedback = bot.feedback === value ? 0 : value;
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "bot" && m.id === bot.id ? { ...m, feedback } : m
      )
    );
    await setMessageFeedbackAction(bot.id, feedback);
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
      setMessages(
        stored.map((message): ChatMsg =>
          message.role === "user"
            ? {
                role: "user",
                text: (message.content as ChatReplyPart[])
                  .map((part) => (part.type === "text" ? part.text : ""))
                  .join(""),
                sentAt: null,
              }
            : {
                role: "bot",
                id: message.id,
                ...EMPTY_TURN_TRACE,
                parts: message.content as ChatReplyPart[],
                streamingText: null,
                feedback: message.feedback,
              }
        )
      );
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
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Teammates
        </Link>
        <div className="ml-2 flex min-w-0 items-center gap-3">
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
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setSettingsOpen(true)}
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
                <PromptInput
                  onSubmit={(value) => void send(value)}
                  minRows={1}
                  maxRows={6}
                  placeholder={`Ask ${teammate.name}...`}
                  aria-label={`Ask ${teammate.name}`}
                />
              )}
            </div>
          </>
        )}
        </div>
      </div>

      {canEdit && settingsOpen && (
        <TeammateSettingsDrawer
          teammate={teammate}
          collections={collections}
          sources={sources}
          sourcesTruncated={sourcesTruncated}
          members={members}
          governance={governance}
          canGrant={canGrant}
          projects={projects}
          learnings={learnings}
          routines={routines}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
