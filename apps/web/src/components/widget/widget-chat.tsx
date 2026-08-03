"use client";

import dynamic from "next/dynamic";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { QuickReplyButton } from "@agent-hub/core";
import type { ChatReplyPart } from "@agent-hub/agent/client";
import { consumeTurnStream, type TurnView } from "@agent-hub/agent/client";
import { toast } from "sonner";
import { ChatHeader } from "@/components/chat/chat-header";
import { ProgressLine } from "@/components/chat/progress-line";
import { FeedbackDialog } from "@/components/chat/feedback-dialog";
import { IdentityGate } from "@/components/chat/identity-gate";
import { FlowButtonIcon } from "@/components/chat/flow-button-icon";
import { hasMarkdownSyntax } from "@/components/chat/markdown-detect";
import { ComposerPulse } from "@/components/chat/composer-pulse";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
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
import {
  latestHelpDeskId,
  repliesClosed,
  visibleReplyParts,
} from "@/components/chat/visible-reply-parts";
import {
  UNREAD_MESSAGE,
  chatOpenFiresOnMount,
  readTriggerMessage,
  triggerReportKey,
  type TriggerReport,
} from "@/lib/widget-triggers";
import type { WidgetConversationSummary } from "./widget-history";
import {
  ArrowRight,
  ExternalLink,
  Headphones,
  HelpCircle,
  Maximize2,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

const LazyChatMarkdown = lazy(async () => {
  const chatMarkdownModule = await import("@/components/chat/chat-markdown");
  return { default: chatMarkdownModule.ChatMarkdown };
});

function DeferredChatMarkdown({ text, className }: { text: string; className?: string }) {
  const plain = (
    <p className={`leading-relaxed whitespace-pre-wrap ${className ?? ""}`}>{text}</p>
  );
  // Plain text never mounts the lazy component â€” React.lazy starts fetching
  // on first render, so gating here keeps the markdown chunk off the initial
  // load (e.g. an unformatted welcome message) until a message needs it.
  if (!hasMarkdownSyntax(text)) return plain;
  return (
    <Suspense fallback={plain}>
      <LazyChatMarkdown text={text} className={className} />
    </Suspense>
  );
}

const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

/**
 * Renders an `iframe` reply part: an inline embed sized by the flow's height
 * config, with an optional lightbox (fullscreen overlay) toggle when enabled.
 */
function IframeReplyPart({
  part,
}: {
  part: Extract<ChatReplyPart, { type: "iframe" }>;
}) {
  const [open, setOpen] = useState(false);
  const title = part.title?.trim() || "Embedded content";
  const height = `${part.height ?? 30}${part.heightUnit ?? "vh"}`;
  return (
    <div className="max-w-[90%]">
      {(part.title || part.lightbox) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {part.title ? (
            <span className="text-sm font-medium">{title}</span>
          ) : (
            <span />
          )}
          {part.lightbox && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open in full screen"
            >
              <Maximize2 className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border">
        <iframe
          src={part.url}
          title={title}
          sandbox={IFRAME_SANDBOX}
          className="w-full"
          style={{ height }}
        />
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="mb-2 flex items-center justify-between text-white">
            <span className="text-sm font-medium">{title}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close full screen"
            >
              <X className="size-5" />
            </button>
          </div>
          <iframe
            src={part.url}
            title={title}
            sandbox={IFRAME_SANDBOX}
            className="w-full flex-1 rounded-lg bg-white"
          />
        </div>
      )}
    </div>
  );
}

type SourcesPart = Extract<ChatReplyPart, { type: "sources" }>;

/** Conceptâ†’Source citations, shaped for the beui citation components. */
function toCitationItems(sources: SourcesPart["sources"]): CitationItem[] {
  return sources.map((source, index) => ({
    id: source.conceptId ?? `source-${index}`,
    title: source.conceptTitle,
    domain: source.sourceName
      ? `${source.collectionName} Â· ${source.sourceName}`
      : source.collectionName,
    url: source.url ?? undefined,
  }));
}

/**
 * One assistant turn: the agent-activity stream, then each reply part. Text
 * parts render as beui StreamingResponse prose â€” the last one carries the
 * completion actions (copy, ðŸ‘/ðŸ‘Ž wired to message feedback) and the sources
 * disclosure built from the turn's Conceptâ†’Source citations.
 */
function BotMessageView({
  msg,
  active,
  hideEscalation,
  brandColor,
  onSend,
  onOpenSupport,
  onVote,
}: {
  msg: BotMsg;
  active: boolean;
  hideEscalation: boolean;
  brandColor: string;
  onSend: (text: string, options?: { faq?: boolean }) => void;
  onOpenSupport: (helpDeskId?: string) => void;
  onVote: (value: -1 | 1) => void;
}) {
  const parts = visibleReplyParts(msg.parts, !hideEscalation);
  const lastTextIndex = parts.reduce(
    (acc, part, index) => (part.type === "text" ? index : acc),
    -1
  );
  const citationItems = toCitationItems(
    parts.flatMap((part) => (part.type === "sources" ? part.sources : []))
  );
  const feedback =
    msg.feedback === 1 ? "up" : msg.feedback === -1 ? "down" : null;

  return (
    <Message from="assistant">
      <MessageContent className="gap-2">
        <ThinkingPanel
          steps={msg.steps}
          phase={msg.phase}
          searchCount={msg.searchCount}
          active={active}
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
                  if (next === "up") onVote(1);
                  else if (next === "down") onVote(-1);
                  // Clearing = re-voting the active value; the server toggles.
                  else onVote(msg.feedback === 1 ? 1 : -1);
                }}
              >
                <DeferredChatMarkdown text={part.text} />
              </StreamingResponse>
            );
          }
          if (part.type === "progress") {
            return <ProgressLine key={j} text={part.text} />;
          }
          if (part.type === "notification") {
            // Proactive nudge: set apart from an answer, since the visitor
            // did not ask for it (accent edge + optional heading).
            return (
              <MessageBubble key={j}>
                <MessageBubbleContent
                  className="max-w-[90%] space-y-1 border-l-2 bg-muted/60 [&>span[aria-hidden]]:bg-transparent"
                  style={{ borderLeftColor: brandColor }}
                >
                  {part.title && <p className="font-medium">{part.title}</p>}
                  <DeferredChatMarkdown text={part.content} />
                </MessageBubbleContent>
              </MessageBubble>
            );
          }
          if (part.type === "help_desk") {
            return (
              <button
                key={j}
                type="button"
                onClick={() => onOpenSupport(part.helpDeskId)}
                className="flex max-w-[90%] items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors hover:bg-muted"
              >
                {part.showIcon !== false && (
                  <FlowButtonIcon
                    icon={part.icon}
                    className="size-5"
                    style={{ color: brandColor }}
                  />
                )}
                <span className="text-sm font-medium">{part.label}</span>
                <ArrowRight className="text-muted-foreground ml-auto size-4" />
              </button>
            );
          }
          if (part.type === "clarify") {
            return (
              <div
                key={j}
                className="bg-muted/40 max-w-[90%] rounded-2xl rounded-tl-sm border border-dashed px-3.5 py-2.5 text-sm"
              >
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
          if (part.type === "sources") {
            // Folded into the last text part's sources disclosure; only a
            // sources-only reply (no text) renders the standalone list.
            if (lastTextIndex !== -1) return null;
            return (
              <Citations
                key={j}
                citations={toCitationItems(part.sources)}
                className="max-w-[90%]"
              />
            );
          }
          if (part.type === "button") {
            if (part.buttonType === "send_text" || part.buttonType === "faq") {
              return (
                <button
                  key={j}
                  type="button"
                  onClick={() =>
                    onSend(part.text ?? "", { faq: part.buttonType === "faq" })
                  }
                  className="inline-flex max-w-[90%] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: brandColor }}
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
                key={j}
                href={part.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-[90%] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: brandColor }}
              >
                {part.label}
                {part.showIcon !== false && (
                  <FlowButtonIcon icon={part.icon} className="size-3.5" />
                )}
              </a>
            );
          }
          if (part.type === "iframe") {
            return <IframeReplyPart key={j} part={part} />;
          }
          if (part.type === "follow_ups") {
            return (
              <div key={j} className="w-full max-w-[92%] pt-1">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-sm">
                    Suggested questions
                  </span>
                  <hr className="flex-1" />
                </div>
                <div className="mt-2 space-y-2">
                  {part.questions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onSend(q)}
                      className="w-full rounded-xl border bg-background px-4 py-3 text-left text-sm leading-snug transition-colors hover:bg-muted"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return null;
        })}
        {msg.streamingText !== null && (
          <StreamingResponse status="streaming">
            <DeferredChatMarkdown text={msg.streamingText} />
            <span className="animate-pulse">â–</span>
          </StreamingResponse>
        )}
        {lastTextIndex === -1 && msg.id && parts.length > 0 && (
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Vote up"
              onClick={() => onVote(1)}
              className={`rounded p-1 transition-colors ${msg.feedback === 1 ? "bg-muted" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ThumbsUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Vote down"
              onClick={() => onVote(-1)}
              className={`rounded p-1 transition-colors ${msg.feedback === -1 ? "bg-muted" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ThumbsDown className="size-3.5" />
            </button>
          </div>
        )}
      </MessageContent>
    </Message>
  );
}

const WidgetHistory = dynamic(
  () => import("./widget-history").then((module) => module.WidgetHistory)
);
const WidgetEscalation = dynamic(
  () => import("./widget-escalation").then((module) => module.WidgetEscalation)
);

interface BotMsg extends TurnView {
  role: "bot";
  id: string | null;
  feedback: -1 | 0 | 1;
}

type Msg = { role: "user"; text: string; sentAt: string | null } | BotMsg;

/** "07 Jul, 14:32" â€” the hover timestamp on a sent message. */
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

function visitorId(): string {
  const key = "ciele-visitor";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function emptyBot(): BotMsg {
  return {
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
  };
}

export function WidgetChat({
  assistantId,
  nickname,
  avatarUrl,
  welcomeMessage,
  aiDisclaimer = "",
  suggestedQuestions,
  quickReplies = [],
  brandColor,
  collections,
  contactLabel = "Contact support",
  hideEscalation = false,
  requireSignIn = false,
}: {
  assistantId: string;
  nickname: string;
  avatarUrl?: string | null;
  welcomeMessage: string;
  /** Disclaimer under the chat window; empty string hides it. */
  aiDisclaimer?: string;
  suggestedQuestions: string[];
  quickReplies?: QuickReplyButton[];
  brandColor: string;
  collections: Array<{ id: string; name: string }>;
  contactLabel?: string;
  hideEscalation?: boolean;
  /** When true, the visitor must complete SSO before the chat is usable. */
  requireSignIn?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<WidgetConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The ?c= Context Hint is resolved client-side so the page shell can stay
  // static â€” one cached page per assistant, not per hint. Embeds can still
  // anchor a conversation to a collection via the URL; there is no in-chat tag
  // control.
  const searchParams = useSearchParams();
  const [anchored] = useState(
    () =>
      collections.find(
        (collection) => collection.id === searchParams.get("c")
      ) ?? null
  );

  // Honor the host page's theme when embedded. A host (e.g. the docs site or
  // the floating launcher) forwards `?theme=dark|light|system`; the widget
  // can't read its embedder's theme cross-origin, so we toggle the `dark`
  // class (and matching `color-scheme`) from the param. Done client-side so
  // the page shell stays static/cached (like the ?c= hint).
  //
  // The host may also change theme *after* load (a light/dark toggle on the
  // embedding page); the launcher forwards those via a `ciele:theme`
  // postMessage, handled below, since the iframe src can't be re-read.
  useEffect(() => {
    const root = document.documentElement;
    const applyDark = (dark: boolean) => {
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    const applyTheme = (theme: string): (() => void) | undefined => {
      if (theme === "system") {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        applyDark(mq.matches);
        const onChange = (e: MediaQueryListEvent) => applyDark(e.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
      }
      applyDark(theme === "dark");
    };

    const initial = searchParams.get("theme");
    const cleanup = initial ? applyTheme(initial) : undefined;

    // Live theme changes from the embedding page (posted by widget.js).
    let mediaCleanup: (() => void) | undefined;
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        data.type === "ciele:theme" &&
        typeof data.theme === "string"
      ) {
        mediaCleanup?.();
        mediaCleanup = applyTheme(data.theme);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      cleanup?.();
      mediaCleanup?.();
      window.removeEventListener("message", onMessage);
    };
  }, [searchParams]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<"chat" | "support">("chat");
  const [supportHelpDeskId, setSupportHelpDeskId] = useState<string>();
  // Mirror of the preview panel's fullscreen: the layout centers in here,
  // and the embedding host (widget.js floater / docs drawer) is asked to
  // expand the iframe via postMessage â€” the iframe can't resize itself.
  const [fullscreen, setFullscreen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Dia-style border pulse on the composer: plays every time the chat input
  // gains focus (ignored while a pulse is already running).
  const [composerPulse, setComposerPulse] = useState(false);

  // Widget SSO gate. `null` while we don't yet know (avoids flashing the gate);
  // resolved from the per-visitor /session endpoint.
  const [gate, setGate] = useState<{
    authenticated: boolean;
    provider: string | null;
  } | null>(requireSignIn ? null : { authenticated: true, provider: null });

  const refreshGate = useCallback(async () => {
    try {
      const res = await fetch(`/api/widget/${assistantId}/session`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        authenticated: boolean;
        provider: string | null;
      };
      setGate({ authenticated: data.authenticated, provider: data.provider });
    } catch {
      // Leave the gate as-is; the chat API is the authoritative enforcer.
    }
  }, [assistantId]);

  useEffect(() => {
    if (!requireSignIn) return;
    let cancelled = false;
    fetch(`/api/widget/${assistantId}/session`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setGate({ authenticated: data.authenticated, provider: data.provider });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [requireSignIn, assistantId]);

  // The login popup posts back on success (see /api/sso/[provider]/callback).
  useEffect(() => {
    if (!requireSignIn) return;
    function onMessage(event: MessageEvent) {
      // The callback posts from our own origin (the iframe's origin); ignore
      // anything else.
      if (event.origin !== window.location.origin) return;
      if (
        event.data &&
        typeof event.data === "object" &&
        event.data.type === "ciele-sso"
      ) {
        void refreshGate();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [requireSignIn, refreshGate]);

  function startLogin(provider: string) {
    const url = `/api/sso/${provider}/start?assistantId=${assistantId}&returnTo=${encodeURIComponent(
      window.location.href
    )}`;
    const popup = window.open(url, "ciele-sso-login", "width=480,height=680");
    // Popup blocked â†’ fall back to a top-level redirect (breaks out of the
    // iframe); the callback returns to `returnTo` with the gate cookie set.
    if (!popup || popup.closed) {
      (window.top ?? window).location.href = url;
    }
  }

  const gated = requireSignIn && (gate === null || !gate.authenticated);

  function fireComposerPulse() {
    if (composerPulse) return;
    setComposerPulse(true);
    window.setTimeout(() => setComposerPulse(false), 1100);
  }

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

  async function send(text: string, options?: { faq?: boolean }) {
    const message = text.trim();
    if (!message || pending) return;
    setDraft("");
    setPending(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: message, sentAt: new Date().toISOString() },
      emptyBot(),
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/widget/${assistantId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: visitorId(),
          conversationId,
          collectionId: anchored?.id ?? null,
          message,
          // The embedding page, forwarded by the launcher as `?u=` â€” the
          // request's own referer is this iframe, not the host page. Gates URL
          // Flow Conditions server-side (spec #550).
          pageUrl: searchParams.get("u"),
          ...(options?.faq ? { faq: true } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("Chat unavailable");

      await consumeTurnStream<BotMsg>(response.body, {
        update: updateLastBot,
        onDone: ({ conversationId, messageId }) => {
          setConversationId(conversationId);
          updateLastBot((bot) => ({ ...bot, id: messageId }));
        },
      });
    } catch {
      /* aborted or network error */
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  /**
   * Reports a proactive trigger and renders whatever it delivers (#541).
   *
   * A trigger with nothing configured for it streams zero bytes, so the bot
   * bubble is appended lazily â€” on the first event â€” and a silent turn leaves the
   * conversation untouched rather than showing an empty message. Each trigger is
   * reported once per mount; the delivery rule itself is enforced server-side.
   */
  const firedTriggers = useRef<Set<string>>(new Set());
  const fireTrigger = useCallback(
    async (report: TriggerReport) => {
      const key = triggerReportKey(report);
      if (firedTriggers.current.has(key)) return;
      firedTriggers.current.add(key);
      try {
        const response = await fetch(`/api/widget/${assistantId}/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId: visitorId(),
            conversationId,
            collectionId: anchored?.id ?? null,
            trigger: report.trigger,
            ...(report.url ? { pageUrl: report.url } : {}),
            ...(report.elapsedSeconds !== undefined
              ? { elapsedSeconds: report.elapsedSeconds }
              : {}),
          }),
        });
        if (!response.ok || !response.body) return;
        let appended = false;
        await consumeTurnStream<BotMsg>(response.body, {
          update: (apply) => {
            if (!appended) {
              appended = true;
              setMessages((prev) => [...prev, { ...emptyBot(), phase: "done" }]);
              // The host owns the launcher, so only it can badge itself â€” and
              // only it knows whether the chat is currently on screen.
              window.parent?.postMessage(UNREAD_MESSAGE, "*");
            }
            updateLastBot(apply);
          },
          onDone: ({ conversationId, messageId }) => {
            setConversationId(conversationId);
            if (appended) updateLastBot((bot) => ({ ...bot, id: messageId }));
          },
        });
      } catch {
        /* network error â€” a nudge is best-effort by nature */
      }
    },
    // The report carries whichever conversation is current when the event fires;
    // re-firing after it changes is a no-op thanks to the per-trigger guard.
    [assistantId, anchored, conversationId]
  );

  // Proactive triggers. The floater script reports what only it can see â€” that
  // the host page loaded, its URL, and that the chat was opened (the frame is
  // warmed long before it is shown). Every other embed renders the chat visible
  // immediately, so for those mounting is opening.
  useEffect(() => {
    if (gated) return;
    if (chatOpenFiresOnMount(new URLSearchParams(searchParams.toString()))) {
      void fireTrigger({ trigger: "chat_open" });
    }
    function onMessage(event: MessageEvent) {
      const report = readTriggerMessage(event.data);
      if (report) void fireTrigger(report);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [gated, searchParams, fireTrigger]);

  async function refreshHistory() {
    try {
      // no-store: the browser otherwise serves a cached list for this stable
      // GET URL, so a conversation created this session wouldn't show until a
      // full page reload.
      const response = await fetch(
        `/api/widget/${assistantId}/conversations?visitorId=${visitorId()}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      setHistory(data.conversations ?? []);
    } catch {
      setHistory([]);
    }
  }

  async function toggleHistory() {
    if (!historyOpen) await refreshHistory();
    setHistoryOpen(!historyOpen);
  }

  async function loadConversation(id: string) {
    const response = await fetch(
      `/api/widget/${assistantId}/conversations?visitorId=${visitorId()}&messages=${id}`,
      { cache: "no-store" }
    );
    const data = await response.json();
    setConversationId(id);
    setHistoryOpen(false);
    setMessages(
      (data.messages ?? []).map((m: { id: string; role: string; content: unknown[]; feedback: -1 | 0 | 1; createdAt?: string }): Msg => {
        if (m.role === "user") {
          const first = m.content[0] as { text?: string } | undefined;
          return { role: "user", text: first?.text ?? "", sentAt: m.createdAt ?? null };
        }
        return {
          ...emptyBot(),
          id: m.id,
          parts: m.content as ChatReplyPart[],
          phase: "done",
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
    await fetch(`/api/widget/${assistantId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: bot.id, feedback }),
    });
  }

  function openSupport(helpDeskId?: string) {
    setSupportHelpDeskId(helpDeskId);
    setView("support");
  }

  function close() {
    window.parent?.postMessage("ciele:close", "*");
  }

  const botReplies = messages.flatMap((message) =>
    message.role === "bot" ? [message.parts] : []
  );
  const recommendedHelpDeskId = latestHelpDeskId(botReplies);
  // A one-way notification closes the composer rather than letting the visitor
  // type into a dead end.
  const composerClosed = repliesClosed(botReplies);

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
  }

  const applyFullscreen = useCallback((next: boolean) => {
    setFullscreen(next);
    // Hosts that know how (widget.js, the docs drawer) expand/restore the
    // iframe; a plain inline iframe simply centers its content.
    window.parent?.postMessage(
      next ? "ciele:fullscreen" : "ciele:restore",
      "*"
    );
  }, []);

  // Escape exits fullscreen â€” same affordance as the editor preview.
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") applyFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, applyFullscreen]);

  async function submitConversationFeedback(text: string): Promise<boolean> {
    if (!conversationId) {
      toast.info("Send a message first, then share feedback on the conversation.");
      return false;
    }
    const response = await fetch(
      `/api/widget/${assistantId}/conversation-feedback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          visitorId: visitorId(),
          text,
        }),
      }
    );
    if (!response.ok) throw new Error("feedback failed");
    return true;
  }

  // â”€â”€ Escalation view ("How would you like to contact â€¦?") â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (view === "support") {
    return (
      <WidgetEscalation
        assistantId={assistantId}
        conversationId={conversationId}
        brandColor={brandColor}
        initialHelpDeskId={supportHelpDeskId}
        onBack={() => {
          setSupportHelpDeskId(undefined);
          setView("chat");
        }}
        onHide={close}
      />
    );
  }

  // â”€â”€ Chat view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div
      className="text-foreground relative flex h-screen flex-col bg-background"
      style={{ ["--brand" as string]: brandColor }}
    >
      {gated && (
        <IdentityGate
          provider={gate?.provider ?? null}
          loading={gate === null}
          onLogin={startLogin}
          brandColor={brandColor}
        />
      )}
      {/* Header â€” shared with the editor preview (chat-header.tsx). */}
      <ChatHeader
        nickname={nickname}
        avatarUrl={avatarUrl}
        historyOpen={historyOpen}
        onToggleHistory={toggleHistory}
        onNewChat={newChat}
        onClose={() =>
          historyOpen
            ? setHistoryOpen(false)
            : fullscreen
              ? applyFullscreen(false)
              : close()
        }
        fullscreen={fullscreen}
        onToggleFullscreen={() => applyFullscreen(!fullscreen)}
        onSendFeedback={() => setFeedbackOpen(true)}
      />

      {/* History â€” full panel, mirrors the editor preview (replaces the
          chat body while open rather than stacking a list above it). */}
      {historyOpen ? (
        <WidgetHistory
          conversations={history}
          activeId={conversationId}
          onSelect={loadConversation}
          onNewChat={newChat}
        />
      ) : (
      <>
      {/* Body â€” beui MessageScroller: follows streamed output while the
          visitor stays at the live edge, with a message navigation rail. */}
      <MessageScroller
        className="min-h-0 flex-1"
        busy={pending}
        navigation="rail"
        viewportClassName={`py-5 ${
          fullscreen ? "px-[max(1.5rem,calc((100%-56rem)/2))]" : "px-4"
        }`}
        contentClassName="space-y-4"
      >
        {welcomeMessage && (
          <DeferredChatMarkdown text={welcomeMessage} className="text-[15px]" />
        )}
        {messages.length === 0 && (
          <div className={fullscreen ? "grid grid-cols-2 gap-3 pt-1" : "space-y-2 pt-1"}>
            {quickReplies.map((button) => (
              <button
                key={button.id}
                type="button"
                onClick={() => {
                  if (button.type === "escalation") openSupport();
                  else if (button.type === "external_link" && button.url)
                    window.open(button.url, "_blank", "noopener,noreferrer");
                  else if (button.text)
                    send(button.text, { faq: button.type === "faq" });
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-center text-[15px] font-medium transition-colors hover:bg-muted"
                style={{ borderColor: brandColor, color: brandColor }}
              >
                {button.label}
                {button.type === "external_link" && (
                  <ExternalLink className="size-3.5 shrink-0" />
                )}
                {button.type === "escalation" && (
                  <Headphones className="size-3.5 shrink-0" />
                )}
              </button>
            ))}
            {suggestedQuestions.map((q) => (
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
                  <MessageBubbleContent className="max-w-[85%] text-white [&>span[aria-hidden]]:bg-(--brand)">
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
            <BotMessageView
              key={i}
              msg={msg}
              active={pending && i === messages.length - 1}
              hideEscalation={hideEscalation}
              brandColor={brandColor}
              onSend={send}
              onOpenSupport={openSupport}
              onVote={(value) => vote(msg, value)}
            />
          )
        )}
      </MessageScroller>

      {/* Composer */}
      <div
        className={
          fullscreen ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6" : "px-4 pb-4"
        }
      >
        {!hideEscalation && (
          <div className="flex justify-center pb-3">
            <button
              type="button"
              onClick={() => openSupport(recommendedHelpDeskId)}
              className="bg-muted hover:bg-muted/80 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors"
            >
              {contactLabel}
            </button>
          </div>
        )}
        <div className="relative">
        {(composerPulse || pending) && (
          <ComposerPulse color={brandColor} focus={composerPulse} loading={pending} />
        )}
        <PromptInput
          value={draft}
          onValueChange={setDraft}
          onSubmit={(value) => {
            if (!composerClosed) send(value);
          }}
          loading={pending}
          onStop={() => abortRef.current?.abort()}
          disabled={composerClosed}
          minRows={1}
          maxRows={6}
          onFocus={fireComposerPulse}
          placeholder={
            composerClosed
              ? "This message doesn't take replies"
              : `Ask ${nickname}...`
          }
          aria-label={`Ask ${nickname}`}
        />
        </div>
        {aiDisclaimer && (
          <p className="text-muted-foreground mt-3 text-xs leading-snug">
            {aiDisclaimer}
          </p>
        )}
      </div>
      </>
      )}

      {/* Send feedback (chat-level, from the â‹¯ menu) â€” shared dialog. */}
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        nickname={nickname}
        onSubmit={submitConversationFeedback}
      />
    </div>
  );
}
