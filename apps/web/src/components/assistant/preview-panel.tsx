"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Assistant, Conversation } from "@agent-hub/core";
import type { ChatReplyPart } from "@agent-hub/agent/client";
import { ChevronDown, Pin, Square, SquarePen, Trash2 } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { decideReviewAction } from "@/app/(admin)/reviews/actions";
import {
  deleteConversationAction,
  getConversationMessagesAction,
  getPreviewSsoGateAction,
  listConversationsAction,
  sendConversationFeedbackAction,
  setConversationPinnedAction,
  setMessageFeedbackAction,
} from "@/app/actions";
import { Button } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { EMPTY_TURN_TRACE, consumeTurnStream } from "@agent-hub/agent/client";
import { playFeedback } from "@agent-hub/ui/feedback";
import { chatFeedbackForEvent } from "@/lib/chat-feedback";
import {
  completeFollowUp,
  initialFollowUpState,
  submitFollowUp,
  type FollowUpCommand,
} from "@/lib/follow-up-scheduler";
import {
  DEFAULT_CONNECTOR_PREFERENCES,
  previewAiPreferencesKey,
  sanitizeConnectorPreferences,
  type ConnectorFollowUpBehavior,
  type ConnectorPreferences,
} from "@/lib/local-connector-protocol";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatSurface, RailPanel } from "@/components/chat/rail-panel";
import { WIDEN_TRANSITION } from "@/components/chat/fullscreen-motion";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import { FeedbackDialog } from "@/components/chat/feedback-dialog";
import { IdentityGate } from "@/components/chat/identity-gate";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import {
  ChatThread,
  type ChatBotMsg,
  type HumanReviewPart,
  type ChatMsg,
} from "@/components/chat/chat-thread";
import { ComposerPulse } from "@/components/chat/composer-pulse";
import { latestHelpDeskId } from "@/components/chat/visible-reply-parts";
import { PreviewEscalation } from "./preview-escalation";
import { RefreshButton } from "./refresh-button";
import type { ReportableTrigger } from "@/lib/widget-triggers";
import { MessageScroller } from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { MessageSquareText } from "lucide-react";

/** The transcript's message shapes live with the renderer they belong to. */
type BotMsg = ChatBotMsg;
type Msg = ChatMsg;

/** History shows this many recent conversations; pinned ones always stay. */
const HISTORY_RECENT_LIMIT = 10;

function historyDayLabel(iso: string): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function PreviewPanel({
  assistant,
  connectorScope,
  startResizing = false,
  variant = "docked",
  collapsed: collapsedProp,
  onCollapsedChange,
}: {
  assistant: Assistant;
  connectorScope: string | null;
  /** Mount already mid-drag, the panel was opened by dragging the collapsed rail. */
  startResizing?: boolean;
  /**
   * Collapsed state, when the mount point owns it. The docked panel shares the
   * workspace's single right rail with the Developer Panel (#754), so "collapsed"
   * means "does not hold the rail" and only the launcher can know that. Omitted
   * (the page variant) falls back to local state.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * `"docked"` is the resizable right-hand column of the assistant editor, a
   * pointer surface, hidden below `md`. `"page"` is the same preview filling a
   * route of its own (the "Preview" SETUP section), which is how the
   * preview is reachable at all on a phone or a portrait tablet: it drops the
   * width, the drag handle and the collapse control, since a page has no
   * neighbour to take room from.
   */
  variant?: "docked" | "page";
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  /**
   * A simulated Human review (#841, story 57): the card's Approve / Reject
   * decides the row through the same operation the decision page uses, and
   * the continuation runs inline, so the next assistant message is appended
   * here rather than waiting for a refresh.
   */
  function decideSimulatedReview(part: HumanReviewPart, decision: "approved" | "rejected") {
    void (async () => {
      try {
        const result = await decideReviewAction(part.reviewId, decision, {});
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "bot"
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.type === "human_review" && p.reviewId === part.reviewId
                      ? { ...p, status: result.review.status, decidedByName: result.review.decidedByName }
                      : p
                  ),
                }
              : m
          )
        );
        if (result.resumed) {
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              id: result.resumed!.messageId,
              ...EMPTY_TURN_TRACE,
              parts: result.resumed!.content as ChatReplyPart[],
              streamingText: null,
              feedback: 0,
            },
          ]);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not record the decision");
      }
    })();
  }
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Full screen grows the panel out of the flow (see use-fullscreen-grow).
  const { fullscreen, setFullscreen, surfaceRef, animating, spacerRef } =
    useFullscreenGrow();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  // Widget SSO gate mirrored in the preview: when this assistant requires
  // sign-in, show the same "Verify your identity" card visitors will see. Reads
  // the LIVE assistant (not a Publication), so it reflects the toggle at once.
  const [ssoGate, setSsoGate] = useState<{
    requireSignIn: boolean;
    authenticated: boolean;
    provider: string | null;
  } | null>(assistant.requireSignIn ? null : { requireSignIn: false, authenticated: true, provider: null });

  const refreshSsoGate = useCallback(async () => {
    try {
      setSsoGate(await getPreviewSsoGateAction(assistant.id));
    } catch {
      // Non-fatal for a preview; leave the current state.
    }
  }, [assistant.id]);

  useEffect(() => {
    if (!assistant.requireSignIn) return;
    let cancelled = false;
    getPreviewSsoGateAction(assistant.id)
      .then((state) => {
        if (!cancelled) setSsoGate(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [assistant.requireSignIn, assistant.id]);

  useEffect(() => {
    if (!assistant.requireSignIn) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data && typeof event.data === "object" && event.data.type === "ciele-sso") {
        void refreshSsoGate();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [assistant.requireSignIn, refreshSsoGate]);

  function startSsoLogin(provider: string) {
    const url = `/api/sso/${provider}/start?assistantId=${assistant.id}&returnTo=${encodeURIComponent(
      window.location.href
    )}`;
    const popup = window.open(url, "ciele-sso-login", "width=480,height=680");
    if (!popup || popup.closed) window.location.href = url;
  }

  const ssoGated =
    assistant.requireSignIn && (ssoGate === null || !ssoGate.authenticated);
  const [aiPreferences, setAiPreferences] = useState<ConnectorPreferences>(
    DEFAULT_CONNECTOR_PREFERENCES
  );
  const [followUpBehavior, setFollowUpBehavior] =
    useState<ConnectorFollowUpBehavior>(
      DEFAULT_CONNECTOR_PREFERENCES.followUpBehavior
    );
  // The escalation screen ("How would you like to contact …?") replaces the
  // chat, mirroring the published widget's support view.
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportHelpDeskId, setSupportHelpDeskId] = useState<string>();
  // Dia-style border pulse on the composer: plays every time the chat input
  // gains focus (ignored while a pulse is already running).
  const [composerPulse, setComposerPulse] = useState(false);

  function fireComposerPulse() {
    if (composerPulse) return;
    setComposerPulse(true);
    window.setTimeout(() => setComposerPulse(false), 1100);
  }
  // The aside, its drag handle, the collapsed rail and the width the shell's
  // furniture moves aside for are `RailPanel`'s (#837). PreviewPanelLauncher is
  // this component's only docked mount point and owns both the persisted
  // preference and the rail claim, so nothing here may re-derive that from
  // localStorage on mount (as it once did): that raced the launcher's decision
  // and could silently re-collapse the panel right after a "Show preview"
  // click had just opened it.
  const abortRef = useRef<AbortController | null>(null);
  const abortWhenStartedRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const followUpStateRef = useRef(initialFollowUpState());

  useEffect(() => {
    const readPreferences = () => {
      try {
        if (!connectorScope) return;
        const raw = window.localStorage.getItem(
          previewAiPreferencesKey(connectorScope)
        );
        if (!raw) return;
        const preferences = sanitizeConnectorPreferences(JSON.parse(raw));
        setAiPreferences(preferences);
        setFollowUpBehavior(preferences.followUpBehavior);
      } catch {
        setAiPreferences(DEFAULT_CONNECTOR_PREFERENCES);
        setFollowUpBehavior(DEFAULT_CONNECTOR_PREFERENCES.followUpBehavior);
      }
    };
    readPreferences();
    window.addEventListener("storage", readPreferences);
    return () => window.removeEventListener("storage", readPreferences);
  }, [connectorScope]);

  /**
   * Proactive triggers in Preview (#545). The preview has no host page, so a
   * preview run *is* the page: mounting or restarting it counts as the page load
   * and the chat opening, and the dwell clock starts there. Which listeners to arm
   * comes from the live flows, the whole point of Preview is unpublished work, so
   * it cannot read the published config the embed reads.
   */
  const [previewRun, setPreviewRun] = useState(0);
  const firePreviewTrigger = useCallback(
    async (trigger: ReportableTrigger, elapsedSeconds?: number) => {
      try {
        const response = await fetch("/api/preview/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assistantId: assistant.id,
            conversationId: conversationIdRef.current,
            collectionId: null,
            trigger,
            ...(elapsedSeconds !== undefined ? { elapsedSeconds } : {}),
          }),
        });
        if (!response.ok || !response.body) return;
        let appended = false;
        await consumeTurnStream<BotMsg>(response.body, {
          update: (apply) => {
            if (!appended) {
              appended = true;
              setMessages((prev) => [
                ...prev,
                {
                  role: "bot",
                  id: null,
                  flowName: null,
                  steps: [],
                  parts: [],
                  streamingText: null,
                  phase: "done",
                  searchCount: 0,
                  iteration: null,
                  iterationLimit: null,
                  terminal: null,
                  feedback: 0,
                },
              ]);
            }
            updateLastBot(apply);
          },
          onDone: ({ conversationId: id, messageId }) => {
            conversationIdRef.current = id;
            setConversationId(id);
            if (appended) updateLastBot((bot) => ({ ...bot, id: messageId }));
          },
        });
      } catch {
        /* a preview nudge is best-effort, like the widget's */
      }
    },
    [assistant.id]
  );

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    fetch(`/api/preview/trigger?assistantId=${assistant.id}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => {
        if (cancelled || !config) return;
        const armed: string[] = config.proactiveTriggers ?? [];
        if (armed.includes("page_load")) void firePreviewTrigger("page_load");
        if (armed.includes("chat_open")) void firePreviewTrigger("chat_open");
        if (armed.includes("time_on_page")) {
          for (const seconds of config.proactiveDwellSeconds ?? []) {
            timers.push(
              setTimeout(
                () => void firePreviewTrigger("time_on_page", seconds),
                seconds * 1000
              )
            );
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [assistant.id, previewRun, firePreviewTrigger]);

  function updateLastBot(update: (bot: BotMsg) => BotMsg) {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "bot") {
          next[i] = update(next[i] as BotMsg);
          break;
        }
      }
      return next;
    });
  }

  function applyFollowUpCommands(commands: FollowUpCommand[]) {
    for (const command of commands) {
      if (command.type === "abort") {
        if (conversationIdRef.current) abortRef.current?.abort();
        else abortWhenStartedRef.current = true;
      }
      else void executeTurn(command.message);
    }
  }

  async function executeTurn(message: string) {
    setPending(true);
    playFeedback("send");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: message, sentAt: new Date().toISOString() },
      {
        role: "bot",
        id: null,
        flowName: null,
        steps: [],
        parts: [],
        streamingText: null,
        phase: "running",
        searchCount: 0,
        iteration: null,
        iterationLimit: null,
        terminal: null,
        feedback: 0,
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const turnId = crypto.randomUUID();

    try {
      const response = await fetch("/api/preview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: assistant.id,
          conversationId: conversationIdRef.current,
          collectionId: null,
          message,
          turnId,
          modelPreference: aiPreferences.defaultModel,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Chat failed (${response.status})`);
      }

      await consumeTurnStream<BotMsg>(response.body, {
        update: updateLastBot,
        onStart: ({ conversationId: startedConversationId }) => {
          conversationIdRef.current = startedConversationId;
          setConversationId(startedConversationId);
          if (abortWhenStartedRef.current) {
            abortWhenStartedRef.current = false;
            abortRef.current?.abort();
          }
        },
        onDone: ({ conversationId, messageId }) => {
          conversationIdRef.current = conversationId;
          setConversationId(conversationId);
          updateLastBot((bot) => ({ ...bot, id: messageId }));
        },
        onEvent: (event) => {
          const cue = chatFeedbackForEvent(event);
          if (cue) playFeedback(cue);
        },
        errorText: (message) => `⚠️ ${message}`,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error instanceof Error ? error.message : "Chat failed");
      }
    } finally {
      abortRef.current = null;
      const transition = completeFollowUp(followUpStateRef.current);
      followUpStateRef.current = transition.state;
      setQueuedCount(transition.state.queued.length);
      if (transition.commands.length > 0) {
        applyFollowUpCommands(transition.commands);
      } else {
        setPending(false);
      }
    }
  }

  function send(text: string) {
    const message = text.trim();
    if (!message) return;
    setDraft("");
    const transition = submitFollowUp(
      followUpStateRef.current,
      message,
      followUpBehavior
    );
    followUpStateRef.current = transition.state;
    setQueuedCount(transition.state.queued.length);
    applyFollowUpCommands(transition.commands);
  }

  function stop() {
    abortWhenStartedRef.current = false;
    followUpStateRef.current = initialFollowUpState();
    setQueuedCount(0);
    abortRef.current?.abort();
  }

  function newChat() {
    stop();
    setMessages([]);
    conversationIdRef.current = null;
    setConversationId(null);
    // A fresh preview conversation is a fresh page: proactive flows fire again.
    setPreviewRun((run) => run + 1);
  }

  async function openHistory() {
    setHistoryOpen(true);
    try {
      setConversations(await listConversationsAction(assistant.id));
    } catch {
      /* history unavailable */
    }
  }

  // The panel keeps the 10 most recent conversations plus every pinned one
  // (the Inbox still logs everything org-side).
  const historyGroups = useMemo(() => {
    const sorted = [...conversations].sort((a, b) =>
      a.updatedAt > b.updatedAt ? -1 : 1
    );
    const visible = [
      ...sorted.filter((c) => c.pinned),
      ...sorted.filter((c) => !c.pinned).slice(0, HISTORY_RECENT_LIMIT),
    ].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));

    const groups: Array<{ label: string; items: Conversation[] }> = [];
    for (const conversation of visible) {
      const label = historyDayLabel(conversation.updatedAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(conversation);
      else groups.push({ label, items: [conversation] });
    }
    return groups;
  }, [conversations]);

  // Escape leaves full screen (matches the standard overlay convention).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen]);

  async function submitFeedback(text: string): Promise<boolean> {
    if (!conversationId) {
      toast.info("Send a message first, then share feedback on the conversation.");
      return false;
    }
    await sendConversationFeedbackAction(conversationId, text);
    return true;
  }

  async function togglePin(conversation: Conversation) {
    const pinned = !conversation.pinned;
    setConversations((prev) =>
      prev.map((c) => (c.id === conversation.id ? { ...c, pinned } : c))
    );
    try {
      await setConversationPinnedAction(conversation.id, pinned);
    } catch {
      toast.error("Could not update the pin");
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversation.id ? { ...c, pinned: !pinned } : c
        )
      );
    }
  }

  async function loadConversation(conversation: Conversation) {
    stop();
    const stored = await getConversationMessagesAction(conversation.id);
    conversationIdRef.current = conversation.id;
    setConversationId(conversation.id);
    setMessages(
      stored.map((m): Msg => {
        if (m.role === "user") {
          const first = m.content[0] as { text?: string } | undefined;
          return { role: "user", text: first?.text ?? "", sentAt: m.createdAt ?? null };
        }
        return {
          role: "bot",
          id: m.id,
          flowName: m.flowName,
          steps: [],
          parts: m.content as ChatReplyPart[],
          streamingText: null,
          phase: "done",
          searchCount: 0,
          iteration: null,
          iterationLimit: null,
          terminal: null,
          feedback: m.feedback,
        };
      })
    );
  }

  async function vote(bot: BotMsg, value: -1 | 1) {
    if (!bot.id) return;
    const feedback = bot.feedback === value ? 0 : value;
    setMessages((prev) =>
      prev.map((m) => (m.role === "bot" && m.id === bot.id ? { ...m, feedback } : m))
    );
    await setMessageFeedbackAction(bot.id, feedback);
  }

  const nickname = assistant.nickname || assistant.title;
  const contactLabel =
    assistant.helpDeskSettings?.contactButtonLabel?.trim() || "Contact support";
  const hideEscalation =
    assistant.helpDeskSettings?.hideEscalationButton ?? false;
  const recommendedHelpDeskId = latestHelpDeskId(
    messages.flatMap((message) => (message.role === "bot" ? [message.parts] : []))
  );

  return (
    <RailPanel
      title="Preview"
      labels={{
        show: "Show preview",
        hide: "Hide preview",
        resize: "Resize preview panel",
      }}
      variant={variant}
      collapsed={collapsedProp}
      onCollapsedChange={onCollapsedChange}
      startResizing={startResizing}
      actions={
        <Hint label="Refresh preview">
          {/* Refresh re-reads the assistant's config *and* restarts the
              preview conversation, so proactive flows fire again. */}
          <RefreshButton onRefresh={newChat} />
        </Hint>
      }
      overlay={
        ssoGated ? (
          <IdentityGate
            provider={ssoGate?.provider ?? null}
            loading={ssoGate === null}
            onLogin={startSsoLogin}
            brandColor={assistant.style?.brandColor ?? "#0a0a0a"}
          />
        ) : null
      }
      banner={
        assistant.chatLauncherEnabled ? null : (
          <p className="text-muted-foreground bg-muted mb-3 rounded-lg px-3 py-2 text-xs">
            Chat launcher is disabled, users won&apos;t see the chat button, but
            you can still test the assistant here.
          </p>
        )
      }
      extras={
        /* Send feedback (chat-level, from the ⋯ menu), shared dialog. */
        <FeedbackDialog
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          nickname={nickname}
          onSubmit={submitFeedback}
        />
      }
    >
      <ChatSurface
        fullscreen={fullscreen}
        animating={animating}
        spacerRef={spacerRef}
        surfaceRef={surfaceRef}
      >
        {/* Escalation: replaces the whole chat surface, like the widget. */}
        {supportOpen && (
          <PreviewEscalation
            assistantId={assistant.id}
            initialHelpDeskId={supportHelpDeskId}
            onBack={() => {
              setSupportHelpDeskId(undefined);
              setSupportOpen(false);
            }}
          />
        )}

        {/* Chat header, shared with the production widget (chat-header.tsx),
            so the preview always shows exactly what production renders. */}
        {!supportOpen && (
          <ChatHeader
            nickname={nickname}
            avatarUrl={assistant.avatarUrl}
            historyOpen={historyOpen}
            onToggleHistory={() =>
              historyOpen ? setHistoryOpen(false) : openHistory()
            }
            onNewChat={newChat}
            onClose={() =>
              historyOpen
                ? setHistoryOpen(false)
                : fullscreen
                  ? setFullscreen(false)
                  : newChat()
            }
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen(!fullscreen)}
            onSendFeedback={() => setFeedbackOpen(true)}
          />
        )}

        {/* History: full-panel beui AI Sidebar showing only conversations
            (date-grouped, pinned first) with Pin/Delete in the row menu. */}
        {!supportOpen && historyOpen && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4">
              <span className="text-primary border-primary inline-block border-b-2 px-1 pt-3 pb-2 text-sm font-semibold">
                My conversations
              </span>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-2 py-2">
              {historyGroups.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  No previous conversations yet
                </p>
              ) : (
                <AISidebar
                  items={historyGroups.map(
                    (group): SidebarResource => ({
                      id: `day:${group.label}`,
                      label: group.label,
                      kind: "folder",
                      children: group.items.map((c) => ({
                        id: c.id,
                        label: c.title || "Untitled conversation",
                        kind: "file",
                      })),
                    })
                  )}
                  activeId={conversationId}
                  defaultExpandedIds={historyGroups.map(
                    (group) => `day:${group.label}`
                  )}
                  onActiveChange={(id) => {
                    if (id.startsWith("day:")) return;
                    const conversation = conversations.find((c) => c.id === id);
                    if (!conversation) return;
                    void loadConversation(conversation);
                    setHistoryOpen(false);
                  }}
                  renderIcon={(item) =>
                    item.kind === "file" ? (
                      conversations.find((c) => c.id === item.id)?.pinned ? (
                        <Pin className="size-4 fill-current text-primary" />
                      ) : (
                        <MessageSquareText className="size-4" />
                      )
                    ) : undefined
                  }
                  renderMenu={(item, controls) => {
                    const conversation = conversations.find(
                      (c) => c.id === item.id
                    );
                    if (!conversation) return null;
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            controls.close();
                            void togglePin(conversation);
                          }}
                          className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Pin className="size-3.5" />
                          {conversation.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            controls.close();
                            await deleteConversationAction(conversation.id);
                            setConversations((prev) =>
                              prev.filter((x) => x.id !== conversation.id)
                            );
                            if (conversationId === conversation.id) newChat();
                          }}
                          className="hover:text-destructive flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <AnimatedIcon icon={Trash2} size={14} />
                          Delete
                        </button>
                      </>
                    );
                  }}
                  ariaLabel="My conversations"
                  // Day-group folders take no actions; conversation rows get
                  // the Pin/Delete menu from renderMenu above.
                  className='w-full [&_[role=treeitem][aria-expanded]_button[aria-label^="Actions for"]]:hidden'
                />
              )}
            </div>
            <div className="flex justify-center border-t px-4 py-3">
              <Button
                variant="outline"
                onClick={() => {
                  newChat();
                  setHistoryOpen(false);
                }}
              >
                <SquarePen className="size-4" /> New chat
              </Button>
            </div>
          </div>
        )}

        {/* Chat body */}
        {!supportOpen && !historyOpen && (
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
          {assistant.welcomeMessage && (
            <ChatMarkdown text={assistant.welcomeMessage} className="text-[0.9375rem]" />
          )}
          {messages.length === 0 && (
            <div className={fullscreen ? "grid grid-cols-2 gap-3 pt-1" : "space-y-2 pt-1"}>
              {assistant.suggestedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="text-foreground w-full rounded-lg bg-foreground/10 px-4 py-2.5 text-center text-[0.9375rem] transition-colors hover:bg-foreground/15"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <ChatThread
            messages={messages}
            pending={pending}
            onSend={send}
            onVote={vote}
            onOpenSupport={(helpDeskId) => {
              setSupportHelpDeskId(helpDeskId);
              setSupportOpen(true);
            }}
            hasPersistentSupport={!hideEscalation}
            onDecideReview={decideSimulatedReview}
          />
        </MessageScroller>

        {/* Chat input */}
        <div
          className={`${WIDEN_TRANSITION} ${
            fullscreen
              ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6"
              : "px-4 pb-4"
          }`}
        >
          {/* Always-available escalation button ("Contact Support Button
              Name"), hidden by the Help Desks "Hide Always Available
              Escalation Button" toggle, same rule as the published widget. */}
          {!hideEscalation && (
            <div className="flex justify-center pb-3">
              <button
                type="button"
                onClick={() => {
                  setSupportHelpDeskId(recommendedHelpDeskId);
                  setSupportOpen(true);
                }}
                className="bg-muted hover:bg-muted/80 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors"
              >
                {contactLabel}
              </button>
            </div>
          )}
          <div className="relative">
          {(composerPulse || pending) && (
            <ComposerPulse color="var(--primary)" focus={composerPulse} loading={pending} />
          )}
          {/* Sending stays enabled while a reply streams, the preview's
              follow-up scheduler queues or steers it, so the composer never
              enters PromptInput's own `loading` mode; a Stop control rides in
              the actions row instead. */}
          <PromptInput
            value={draft}
            onValueChange={setDraft}
            onSubmit={(value) => send(value)}
            onFocus={fireComposerPulse}
            minRows={1}
            maxRows={6}
            placeholder={`Ask ${nickname}...`}
            aria-label={`Ask ${nickname}`}
            leadingAction={
              pending ? (
                <Hint label="Stop generating and clear follow-ups" side="top">
                  <button
                    type="button"
                    aria-label="Stop generating and clear follow-ups"
                    onClick={stop}
                    className="border-input hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors"
                  >
                    <Square className="size-3 fill-current" />
                  </button>
                </Hint>
              ) : undefined
            }
          />
          {pending && (
            <p className="text-muted-foreground mt-1 text-2xs">
              {followUpBehavior === "steer"
                ? "New messages steer the current reply"
                : queuedCount > 0
                  ? `${queuedCount} follow-up${queuedCount === 1 ? "" : "s"} queued`
                  : "New messages wait in the queue"}
            </p>
          )}
          </div>
          {assistant.aiDisclaimer && (
            <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-xs leading-snug">
              <ChevronDown className="mt-0.5 size-3.5 shrink-0" />
              {assistant.aiDisclaimer}
            </p>
          )}
        </div>
        </>
        )}
      </ChatSurface>
    </RailPanel>
  );
}
