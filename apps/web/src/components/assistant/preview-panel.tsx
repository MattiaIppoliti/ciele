"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Assistant, Conversation } from "@agent-hub/core";
import type { ChatReplyPart } from "@agent-hub/agent/client";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  HelpCircle,
  Pin,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
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
import { ResizeHandle, useResizableWidth } from "@/components/ui/resizable-panel";
import { consumeTurnStream, type TurnView } from "@agent-hub/agent/client";
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
import { FeedbackDialog } from "@/components/chat/feedback-dialog";
import { ProgressLine } from "@/components/chat/progress-line";
import { IdentityGate } from "@/components/chat/identity-gate";
import { FlowButtonIcon } from "@/components/chat/flow-button-icon";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { ComposerPulse } from "@/components/chat/composer-pulse";
import {
  latestHelpDeskId,
  visibleReplyParts,
} from "@/components/chat/visible-reply-parts";
import { PreviewEscalation } from "./preview-escalation";
import { RefreshButton } from "./refresh-button";
import type { ReportableTrigger } from "@/lib/widget-triggers";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageScroller,
} from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { Citations, type CitationItem } from "@/components/agents/citations";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { MessageSquareText } from "lucide-react";

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

interface UserMsg {
  role: "user";
  text: string;
  sentAt: string | null;
}

interface BotMsg extends TurnView {
  role: "bot";
  id: string | null;
  feedback: -1 | 0 | 1;
}

type Msg = UserMsg | BotMsg;

const PANEL_DEFAULT_WIDTH = 400;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 640;
/** Width of the collapsed rail (w-12) — where an opening drag starts from. */
const PANEL_RAIL_WIDTH = 48;
/** Release a drag below this width and the panel collapses back to the rail. */
const PANEL_COLLAPSE_THRESHOLD = 180;
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

/** "07 Jul, 14:32" — the hover timestamp on a sent message. */
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
}: {
  part: ChatReplyPart;
  onSend: (text: string) => void;
  onOpenSupport: (helpDeskId?: string) => void;
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

export function PreviewPanel({
  assistant,
  connectorScope,
  startResizing = false,
}: {
  assistant: Assistant;
  connectorScope: string | null;
  /** Mount already mid-drag — the panel was opened by dragging the collapsed rail. */
  startResizing?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
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
  const [collapsed, setCollapsed] = useState(false);
  const { width, fade, resizing, beginResize, containerRef: asideRef } =
    useResizableWidth({
      defaultWidth: PANEL_DEFAULT_WIDTH,
      minWidth: PANEL_MIN_WIDTH,
      maxWidth: PANEL_MAX_WIDTH,
      initialResizing: startResizing,
      overdrag: {
        railWidth: PANEL_RAIL_WIDTH,
        collapseThreshold: PANEL_COLLAPSE_THRESHOLD,
        onCollapse: () => toggleCollapsed(true),
      },
    });

  // PreviewPanelLauncher is this component's only mount point, and it
  // already decided the panel should be open before rendering it — so
  // `collapsed` just starts false here. It must not re-derive its own
  // opinion from localStorage on mount (as it once did): that raced the
  // launcher's decision and could silently re-collapse the panel right
  // after a "Show preview" click had just opened it.
  function toggleCollapsed(value: boolean) {
    setCollapsed(value);
    try {
      window.localStorage.setItem("preview-panel-collapsed", value ? "1" : "0");
    } catch {
      /* private mode */
    }
  }
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
   * comes from the live flows — the whole point of Preview is unpublished work, so
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

    try {
      const response = await fetch("/api/preview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: assistant.id,
          conversationId: conversationIdRef.current,
          collectionId: null,
          message,
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
  }, [fullscreen]);

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

  // Collapsed: slim rail with a « button that reopens the panel. Dragging the
  // handle also reopens it — the panel grows from the rail under the pointer,
  // fading in, and snaps to PANEL_MIN_WIDTH on release (Spotify-style).
  if (collapsed) {
    return (
      <aside className="bg-background relative hidden w-12 shrink-0 flex-col items-center border-l pt-4 md:flex">
        <ResizeHandle
          resizing={resizing}
          onPointerDown={() => {
            toggleCollapsed(false);
            beginResize(PANEL_RAIL_WIDTH);
          }}
          label="Resize preview panel"
        />
        <Hint label="Show preview" side="left">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Show preview"
            onClick={() => toggleCollapsed(false)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
        </Hint>
      </aside>
    );
  }

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className={`bg-background relative hidden shrink-0 flex-col border-l md:flex ${
        resizing ? "" : "transition-[width] duration-200 ease-out"
      }`}
    >
      <ResizeHandle
        resizing={resizing}
        onPointerDown={() => beginResize()}
        label="Resize preview panel"
      />
      {ssoGated && (
        <IdentityGate
          provider={ssoGate?.provider ?? null}
          loading={ssoGate === null}
          onLogin={startSsoLogin}
          brandColor={assistant.style?.brandColor ?? "#0a0a0a"}
        />
      )}
      {/* Clips the content only — the resize handle overhangs the panel's
          left edge and must stay fully visible. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-end overflow-hidden">
      {/* Content keeps its readable min width while the panel is dragged
          narrower — it slides out of view fading, instead of reflowing. */}
      <div
        style={{ width: Math.max(width, PANEL_MIN_WIDTH), opacity: fade }}
        className={`flex min-h-0 flex-1 flex-col px-5 py-4 ${
          resizing ? "" : "transition-opacity duration-200 ease-out"
        }`}
      >
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-lg font-semibold">Preview</h2>
        <div className="flex items-center gap-1">
          <Hint label="Refresh preview">
            {/* Refresh re-reads the assistant's config *and* restarts the
                preview conversation, so proactive flows fire again. */}
            <RefreshButton onRefresh={newChat} />
          </Hint>
          <Hint label="Hide preview">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide preview"
              onClick={() => toggleCollapsed(true)}
            >
              <ChevronsRight className="size-4" />
            </Button>
          </Hint>
        </div>
      </div>

      {!assistant.chatLauncherEnabled && (
        <p className="text-muted-foreground bg-muted mb-3 rounded-lg px-3 py-2 text-xs">
          Chat launcher is disabled — users won&apos;t see the chat button, but
          you can still test the assistant here.
        </p>
      )}

      <div
        className={
          fullscreen
            ? "fixed inset-0 z-50 flex flex-col bg-card"
            : "bg-card flex min-h-0 flex-1 flex-col rounded-xl border"
        }
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

        {/* Chat header — shared with the production widget (chat-header.tsx),
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
          viewportClassName={`py-5 ${
            fullscreen ? "px-[max(1.5rem,calc((100%-56rem)/2))]" : "px-4"
          }`}
          contentClassName="space-y-4"
        >
          {assistant.welcomeMessage && (
            <ChatMarkdown text={assistant.welcomeMessage} className="text-[15px]" />
          )}
          {messages.length === 0 && (
            <div className={fullscreen ? "grid grid-cols-2 gap-3 pt-1" : "space-y-2 pt-1"}>
              {assistant.suggestedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="text-foreground w-full rounded-lg bg-foreground/10 px-4 py-2.5 text-center text-[15px] transition-colors hover:bg-foreground/15"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <Message key={i} from="user" animateIn className="group relative">
                <MessageContent>
                  <MessageBubble>
                    <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
                      {msg.text}
                    </MessageBubbleContent>
                  </MessageBubble>
                  {msg.sentAt && (
                    <span className="text-muted-foreground/80 pointer-events-none absolute right-1 -bottom-4 text-[10px] whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      {sentAtLabel(msg.sentAt)}
                    </span>
                  )}
                </MessageContent>
              </Message>
            ) : (
              (() => {
                const parts = visibleReplyParts(msg.parts, !hideEscalation);
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
                      {/* Flows are deliberately invisible to chat users — routing
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
                              sources={isLast ? citationItems : []}
                              feedback={isLast ? feedback : null}
                              onFeedbackChange={(next) => {
                                if (next === "up") vote(msg, 1);
                                else if (next === "down") vote(msg, -1);
                                // Clearing = re-voting the active value.
                                else vote(msg, msg.feedback === 1 ? 1 : -1);
                              }}
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
                            onSend={send}
                            onOpenSupport={(helpDeskId) => {
                              setSupportHelpDeskId(helpDeskId);
                              setSupportOpen(true);
                            }}
                          />
                        );
                      })}
                      {msg.streamingText !== null && (
                        <StreamingResponse status="streaming">
                          <ChatMarkdown text={msg.streamingText} />
                          <span className="animate-pulse">▍</span>
                        </StreamingResponse>
                      )}
                      {lastTextIndex === -1 && msg.id && parts.length > 0 && (
                        <div className="flex gap-1">
                          <Hint label="Good response">
                            <button
                              type="button"
                              aria-label="Good response"
                              onClick={() => vote(msg, 1)}
                              className={`rounded p-1 transition-colors ${msg.feedback === 1 ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              <ThumbsUp className="size-3.5" />
                            </button>
                          </Hint>
                          <Hint label="Bad response">
                            <button
                              type="button"
                              aria-label="Bad response"
                              onClick={() => vote(msg, -1)}
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
        </MessageScroller>

        {/* Chat input */}
        <div
          className={
            fullscreen
              ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6"
              : "px-4 pb-4"
          }
        >
          {/* Always-available escalation button ("Contact Support Button
              Name"), hidden by the Help Desks "Hide Always Available
              Escalation Button" toggle — same rule as the published widget. */}
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
          {/* Sending stays enabled while a reply streams — the preview's
              follow-up scheduler queues or steers it — so the composer never
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
            <p className="text-muted-foreground mt-1 text-[11px]">
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
      </div>
      </div>
      </div>

      {/* Send feedback (chat-level, from the ⋯ menu) — shared dialog. */}
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        nickname={nickname}
        onSubmit={submitFeedback}
      />
    </aside>
  );
}
