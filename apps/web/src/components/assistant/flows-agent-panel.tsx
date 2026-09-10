"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FlowInput, FlowPatch } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, consumeTurnStream } from "@agent-hub/agent/client";
import { playFeedback } from "@agent-hub/ui/feedback";
import { Button } from "@agent-hub/ui";
import { SquarePen } from "lucide-react";
import { chatMessagesFromStored } from "@/components/chat/stored-messages";
import { chatFeedbackForEvent } from "@/lib/chat-feedback";
import type { FlowDraft } from "@/lib/flow-editor";
import { FLOW_ACTIONS, FLOW_TRIGGER_LABELS } from "@/lib/flow-actions";
import { flowsAgentPayload, type FlowsAgentProposalPayload } from "@/lib/flows-agent";
import { toast } from "@/lib/toast";
import { ChatThread, type ChatBotMsg, type ChatMsg } from "@/components/chat/chat-thread";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatSurface, RailPanel } from "@/components/chat/rail-panel";
import { WIDEN_TRANSITION } from "@/components/chat/fullscreen-motion";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import { MessageScroller } from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { createFlowAction } from "@/app/actions";
import {
  flowsAgentConversationAction,
  flowsAgentThreadAction,
} from "@/app/(admin)/assistants/[id]/flows/flows-agent-actions";

/**
 * The Flows Agent panel (#838): the Teammate chat, docked in the workspace's
 * right rail, where the live Preview sits.
 *
 * It wears the Preview's chrome exactly (`chat/rail-panel.tsx` for the aside,
 * `chat/chat-header.tsx` for the surface header, `ChatThread` for the
 * transcript, `PromptInput` for the composer), because to a Member the two are
 * one thing, the chat at the right edge, and they take turns holding one rail:
 * opening this closes the Preview and the reverse. Same widths, same drag, same
 * full screen.
 *
 * The **chrome** is what is shared, never the capability. This panel authors
 * Flows; the Preview does not, and the published widget, which renders the same
 * header and the same transcript on someone else's website, only ever triggers
 * the Flows an Editor built here. Nothing in this file is reachable from the
 * widget: it talks to an Editor-gated route of its own and edits a draft that
 * exists only in this browser.
 *
 * What is its own is small: every turn carries the open draft, a `flows.draft`
 * hand-back on the stream becomes one edit to that draft (through the builder's
 * `update`, so it is one Undo step), and a `flows.propose` hand-back becomes a
 * card the Editor can accept. The agent never saves; Save stays where it was.
 */
export function FlowsAgentPanel({
  assistantId,
  flowId,
  draft,
  onDraftPatch,
  collapsed,
  onCollapsedChange,
  initialMessage,
  providerReady = true,
}: {
  assistantId: string;
  /** The open Flow, null on the new-Flow canvas. Scopes the panel's history. */
  flowId: string | null;
  /** The live draft, sent with every message so the agent sees what the Editor sees. */
  draft: FlowDraft;
  /** Applies a validated patch to the draft as one undo step. */
  onDraftPatch: (patch: FlowPatch, summary: string) => void;
  /**
   * Whether the panel currently holds the rail. The builder owns this, the same
   * way `PreviewPanelLauncher` owns the Preview's: "collapsed" means "something
   * else has the rail", and only the mount point knows that.
   */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The prompt the Editor typed into the empty canvas, sent on mount. */
  initialMessage?: string | null;
  /**
   * Whether a turn has anything to run on: the Organization holds a Provider
   * Connection, or has opted into Members' own subscriptions (ADR-0007). False
   * means no turn can succeed, so the composer is disabled and the panel says
   * why, instead of every message coming back as an error bubble.
   */
  providerReady?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Full screen grows the panel out of the flow, exactly as the Preview's does.
  const { fullscreen, setFullscreen, surfaceRef, animating, spacerRef } =
    useFullscreenGrow();
  const [history, setHistory] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [proposals, setProposals] = useState<(FlowsAgentProposalPayload & { key: string })[]>([]);
  const [, startTransition] = useTransition();
  const conversationRef = useRef<string | null>(null);

  const updateLastBot = (fn: (bot: ChatBotMsg) => ChatBotMsg) =>
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "bot") next[next.length - 1] = fn(last);
      return next;
    });

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending || !providerReady) return;
    setPending(true);
    playFeedback("send");
    const turnId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { role: "user", text: message, sentAt: new Date().toISOString() },
      { role: "bot", id: null, ...EMPTY_TURN_TRACE, parts: [], streamingText: null, feedback: 0 },
    ]);
    try {
      const response = await fetch(`/api/assistants/${assistantId}/flows-agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationRef.current,
          flowId,
          draft,
          message,
          turnId,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 403
            ? "Only editors can use the Flows Agent"
            : `Chat failed (${response.status})`
        );
      }
      await consumeTurnStream<ChatBotMsg>(response.body, {
        update: updateLastBot,
        onStart: ({ conversationId }) => {
          conversationRef.current = conversationId;
        },
        onDone: ({ conversationId, messageId }) => {
          conversationRef.current = conversationId;
          updateLastBot((bot) => ({ ...bot, id: messageId }));
        },
        onEvent: (event) => {
          const cue = chatFeedbackForEvent(event);
          if (cue) playFeedback(cue);
          const payload = flowsAgentPayload(event);
          if (!payload) return;
          if (payload.kind === "draft") {
            onDraftPatch(payload.patch, payload.summary);
          } else {
            setProposals((prev) => [...prev, { ...payload, key: crypto.randomUUID() }]);
          }
        },
        errorText: (text) => `⚠️ ${text}`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chat failed");
    } finally {
      setPending(false);
    }
  }

  // The prompt typed into the empty canvas is this panel's first message.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialMessage || sentInitial.current) return;
    sentInitial.current = true;
    void send(initialMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    try {
      const rows = await flowsAgentThreadAction(assistantId, flowId);
      setHistory(rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt })));
    } catch {
      toast.error("Could not load earlier conversations");
    }
  }

  async function openConversation(id: string) {
    try {
      const { messages: stored } = await flowsAgentConversationAction(assistantId, id);
      conversationRef.current = id;
      setProposals([]);
      setMessages(chatMessagesFromStored(stored));
      setHistoryOpen(false);
    } catch {
      toast.error("Could not open that conversation");
    }
  }

  function newChat() {
    conversationRef.current = null;
    setMessages([]);
    setProposals([]);
    setHistoryOpen(false);
  }

  function acceptProposal(proposal: FlowsAgentProposalPayload & { key: string }) {
    startTransition(async () => {
      try {
        const flow = await createFlowAction(assistantId, proposal.flow);
        setProposals((prev) => prev.filter((p) => p.key !== proposal.key));
        toast.success(`Created "${flow.name}"`);
        router.push(`/assistants/${assistantId}/flows/${flow.id}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not create the flow");
      }
    });
  }

  return (
    <RailPanel
      // No heading and no strapline: the chat surface below already says
      // "Flows Agent", and the note about drafting belongs in the docs, not
      // above every conversation.
      labels={{
        show: "Show Flows Agent",
        hide: "Hide Flows Agent",
        resize: "Resize Flows Agent panel",
      }}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      // Collapsed it draws nothing rather than a second 48px strip beside the
      // Preview's: the canvas header's Agent button is the way back, and two
      // strips would offer two reopen paths for two panels that cannot both be
      // open anyway.
      whenCollapsed="hidden"
      // The chat header's Close closes the panel, so the row above it needs no
      // Hide of its own.
      hideControl={false}
      // The transcript's own rounded edge is the panel's edge: no gutter of
      // the rail's background around it.
      flush
    >
      <ChatSurface
        fullscreen={fullscreen}
        animating={animating}
        spacerRef={spacerRef}
        surfaceRef={surfaceRef}
      >
        {/* The same header the Preview and the published widget render. No
            "send feedback": this transcript is an Editor talking to a tool
            about their own draft, not an answer anyone rates. */}
        <ChatHeader
          nickname="Flows Agent"
          historyOpen={historyOpen}
          onToggleHistory={() => void toggleHistory()}
          onNewChat={newChat}
          // Close backs out of whatever is in front first, then closes
          // the panel; a Member who wants a blank transcript has New chat.
          onClose={() => {
            if (historyOpen) setHistoryOpen(false);
            else if (fullscreen) setFullscreen(false);
            else onCollapsedChange(true);
          }}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
        />

        {historyOpen && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4">
              <span className="text-primary border-primary inline-block border-b-2 px-1 pt-3 pb-2 text-sm font-semibold">
                Earlier conversations
              </span>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-2 py-2">
              {history.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  No earlier conversations about this flow
                </p>
              ) : (
                <ul className="space-y-1">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="hover:bg-muted press flex w-full flex-col items-start rounded-md px-3 py-2 text-left"
                        onClick={() => void openConversation(entry.id)}
                      >
                        <span className="truncate text-sm font-medium">
                          {entry.title || "Conversation"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {new Date(entry.updatedAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t px-4 py-3">
              <Button type="button" variant="outline" size="sm" onClick={newChat}>
                <SquarePen className="size-4" /> New chat
              </Button>
            </div>
          </div>
        )}

        {!historyOpen && (
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
              {messages.length === 0 && !providerReady && (
                <p className="text-muted-foreground text-sm">
                  No AI provider is connected for this organization, so the Flows Agent has
                  nothing to answer with. An Owner connects one under Settings → AI.
                </p>
              )}
              {messages.length === 0 && providerReady && (
                <div className="text-muted-foreground space-y-2 text-sm">
                  <p>Describe what this flow should do. For example:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      “When a student asks about refunds, answer from our knowledge and offer
                      the finance desk.”
                    </li>
                    <li>“Post a Slack message when a visitor asks for a callback.”</li>
                    <li>“Show a welcome notification after 30 seconds on the page.”</li>
                  </ul>
                </div>
              )}
              <ChatThread messages={messages} pending={pending} onSend={send} />
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.key}
                  proposal={proposal}
                  onAccept={() => acceptProposal(proposal)}
                  onDismiss={() =>
                    setProposals((prev) => prev.filter((p) => p.key !== proposal.key))
                  }
                />
              ))}
            </MessageScroller>

            <div
              className={`${WIDEN_TRANSITION} ${
                fullscreen ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6" : "px-4 pb-4"
              }`}
            >
              {!providerReady && (
                <p className="text-muted-foreground mb-2 text-xs">
                  Connect an AI provider under Settings → AI to use the Flows Agent.
                </p>
              )}
              <PromptInput
                onSubmit={(value) => void send(value)}
                loading={pending}
                disabled={!providerReady}
                minRows={1}
                maxRows={6}
                placeholder={
                  providerReady
                    ? "Describe the flow, or ask for a change…"
                    : "No AI provider connected"
                }
                aria-label="Ask the Flows Agent"
              />
            </div>
          </>
        )}
      </ChatSurface>
    </RailPanel>
  );
}

/** A `flows.propose` hand-back: a whole Flow the Editor may create, or not. */
function ProposalCard({
  proposal,
  onAccept,
  onDismiss,
}: {
  proposal: FlowsAgentProposalPayload;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { flow } = proposal;
  const trigger = flow.trigger ?? "message";
  return (
    <div className="bg-card mt-3 rounded-lg border p-3 text-sm shadow-sm">
      <p className="text-muted-foreground text-xs font-medium uppercase">Proposed flow</p>
      <p className="mt-1 font-semibold">{flow.name}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {FLOW_TRIGGER_LABELS[trigger]}
        {flow.actions?.length
          ? ` → ${flow.actions.map((action) => FLOW_ACTIONS[action].label).join(" → ")}`
          : ""}
      </p>
      {proposal.rationale && <p className="mt-2">{proposal.rationale}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={onAccept}>
          Create and open
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export type { FlowInput };
