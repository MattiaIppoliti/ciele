"use client";

import { useEffect, useRef, useState } from "react";
import type { TurnPhase, TurnStep } from "@agent-hub/agent/client";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageScroller,
} from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { type CitationItem } from "@/components/agents/citations";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { ProgressLine } from "@/components/chat/progress-line";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { ChatHeader } from "@/components/chat/chat-header";
import { useShouldAnimate } from "@/components/home/use-in-viewport";
import { cn } from "@/lib/utils";

/* The live-preview shot on /features/assistants, played rather than framed:
   one scripted conversation through the real widget components — quick
   replies, the Thinking panel with its plan and tool calls, Simplified-
   thinking progress lines, a streamed markdown answer with citations, and
   the follow-up questions — looping while it is on screen. The same script
   the dev showcase runs (/dev/chat-showcase), retold with neutral copy.

   Pure fixture data through the real components; nothing here talks to the
   runtime. Inert: a picture that moves, not a widget you can type into.
   Off screen or under prefers-reduced-motion it holds the finished
   conversation instead of animating. */

const USER_QUESTION = "When is my next invoice due, and how much will it be?";

const WELCOME =
  "Hi! I'm the Acme assistant. Ask me anything about your account, billing or getting set up.";

const ANSWER_MARKDOWN = `Your next invoice is **€348**, due on **March 1**.

- Plan: **Pro**, 12 seats, billed monthly
- Price: **€29 per seat / month**
- Payment method: card ending **4242**

The record from the billing API:

\`\`\`json
{
  "workspace": "acme-inc",
  "plan": "pro",
  "seats": 12,
  "next_invoice_eur": 348,
  "due_date": "2027-03-01"
}
\`\`\`

Switching to annual billing is prorated on the next invoice.`;

const SOURCES: CitationItem[] = [
  {
    id: "c-billing",
    title: "Billing & invoicing policy",
    domain: "Docs · billing-guide.pdf",
  },
  {
    id: "c-payment",
    title: "Payment methods & receipts",
    domain: "Docs · billing-guide.pdf",
  },
  {
    id: "c-web-billing",
    title: "Manage your subscription",
    domain: "help.acme.com",
    url: "https://example.com/help/billing",
  },
];

const FOLLOW_UPS = [
  "Can I switch to annual billing?",
  "How do I update my payment method?",
];

const THOUGHT_TEXT =
  "The visitor is asking about their next invoice. I should read the billing policy pack, pull their account record from the billing API, then answer with citations.";

const API_RESPONSE =
  '{\n  "workspace": "acme-inc",\n  "plan": "pro",\n  "seats": 12,\n  "next_invoice_eur": 348,\n  "due_date": "2027-03-01"\n}';

interface ScriptApi {
  setSteps: (update: (steps: TurnStep[]) => TurnStep[]) => void;
  setPhase: (phase: TurnPhase) => void;
  setProgress: (lines: string[]) => void;
  setStreaming: (text: string | null) => void;
  setAnswered: (answered: boolean) => void;
}

/** The scripted step sequence — (delayMs, apply) pairs run in order. */
function buildScript(api: ScriptApi): Array<[number, () => void]> {
  const { setSteps, setPhase, setProgress, setStreaming, setAnswered } = api;
  const upsert = (step: TurnStep) =>
    setSteps((steps) => {
      const index = steps.findIndex((s) => s.id === step.id);
      if (index === -1) return [...steps, step];
      const next = [...steps];
      next[index] = step;
      return next;
    });

  const plan = (
    read: TurnStep["status"],
    query: TurnStep["status"],
    draft: TurnStep["status"]
  ) => {
    upsert({ id: "p1", kind: "step", stage: "search", label: "Read the billing knowledge pack", status: read });
    upsert({ id: "p2", kind: "step", stage: "search", label: "Query the billing API", status: query });
    upsert({ id: "p3", kind: "step", stage: "generate", label: "Draft the answer with citations", status: draft });
  };

  // Streamed markdown: cut at stable boundaries so the fence closes late.
  const cuts = [70, 140, 210, 290, 380, 470, ANSWER_MARKDOWN.length];

  return [
    [300, () => {
      setPhase("running");
      upsert({ id: "n1", kind: "notice", label: "Classifying intent", detail: "Matched flow “Billing & invoices”", status: "done" });
    }],
    [500, () => upsert({ id: "t1", kind: "thought", label: THOUGHT_TEXT.slice(0, 58), status: "running" })],
    [600, () => upsert({ id: "t1", kind: "thought", label: THOUGHT_TEXT, status: "done" })],
    [400, () => {
      plan("running", "running", "running");
      upsert({
        id: "s1", kind: "tool", tool: "searchKnowledge",
        label: "Searching knowledge for “next invoice amount and due date”",
        status: "running",
        input: { queries: ["next invoice due date", "billing cycle and seats"] },
      });
      setProgress(["Checking the billing policy…"]);
    }],
    [900, () => {
      plan("done", "running", "running");
      upsert({
        id: "s1", kind: "tool", tool: "searchKnowledge",
        label: "Searching knowledge for “next invoice amount and due date”",
        status: "done",
        input: { queries: ["next invoice due date", "billing cycle and seats"] },
        detail: "2 concepts matched, billing-guide.pdf",
        durationMs: 121,
        iteration: 1,
      });
      upsert({
        id: "s2", kind: "tool", tool: "queryApi",
        label: "Querying the billing API",
        status: "running",
        input: { path: "/workspaces/{id}/billing", parameters: { id: "acme-inc" } },
      });
      setProgress(["Checking the billing policy…", "Looking up your account…"]);
    }],
    [900, () => {
      plan("done", "done", "running");
      upsert({
        id: "s2", kind: "tool", tool: "queryApi",
        label: "Querying the billing API",
        status: "done",
        input: { path: "/workspaces/{id}/billing", parameters: { id: "acme-inc" } },
        detail: "Fetched the billing record",
        result: {
          endpoint: "/workspaces/acme-inc/billing",
          method: "GET",
          status: 200,
          response: API_RESPONSE,
        },
        durationMs: 287,
        iteration: 2,
      });
    }],
    [600, () => {
      plan("done", "done", "done");
      upsert({
        id: "s3", kind: "tool", tool: "readyToAnswer",
        label: "Getting ready to answer…",
        status: "done",
        result: { status: "answer" },
        durationMs: 11,
        iteration: 3,
      });
    }],
    ...cuts.map(
      (cut, index): [number, () => void] => [
        index === 0 ? 450 : 240,
        () => setStreaming(ANSWER_MARKDOWN.slice(0, cut)),
      ]
    ),
    [400, () => {
      setStreaming(null);
      setAnswered(true);
      setPhase("done");
      setProgress([]);
    }],
  ];
}

/** The frame every loop ends on — also the still shown before the loop has
 *  ever run (reduced motion, or the observer's first tick). */
const FINAL_STEPS: TurnStep[] = (() => {
  const steps: TurnStep[] = [];
  const script = buildScript({
    setSteps: (update) => {
      const next = update(steps);
      steps.length = 0;
      steps.push(...next);
    },
    setPhase: () => {},
    setProgress: () => {},
    setStreaming: () => {},
    setAnswered: () => {},
  });
  for (const [, apply] of script) apply();
  return steps;
})();

/** Loop pacing: how long the finished answer holds before replaying. */
const DWELL_MS = 4000;

/* One dial over the whole script's tempo. The delays above are written as the
   turn's *shape* — which beat is longer than which — and this stretches them:
   played at their raw speed the assistant reasoned and answered faster than a
   reader can follow the panel, so the thinking never registered. */
const PACE = 1.5;

const noop = () => {};

export function AssistantPreviewDemo({
  className,
  cardClassName,
}: {
  className?: string;
  cardClassName?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const active = useShouldAnimate(frameRef);

  // Starts on the finished conversation; the first activation resets and
  // plays. Under reduced motion `active` never flips, so this is all there is.
  const [steps, setSteps] = useState<TurnStep[]>(FINAL_STEPS);
  const [phase, setPhase] = useState<TurnPhase>("done");
  const [progress, setProgress] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [answered, setAnswered] = useState(true);
  // Remounts the scripted turn per replay, so the panel's elapsed clock and
  // entrance animations start fresh each run.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timers: number[] = [];
    // Deferred a tick so the effect body itself never calls setState.
    timers.push(
      window.setTimeout(() => {
        setSteps([]);
        setPhase("running");
        setProgress([]);
        setStreaming(null);
        setAnswered(false);
      }, 0)
    );

    let at = 0;
    for (const [delay, apply] of buildScript({
      setSteps,
      setPhase,
      setProgress,
      setStreaming,
      setAnswered,
    })) {
      at += delay * PACE;
      timers.push(window.setTimeout(apply, at));
    }
    // The loop: hold the finished answer, then replay from the top.
    timers.push(
      window.setTimeout(() => setRunId((run) => run + 1), at + DWELL_MS)
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [active, runId]);

  const pending = phase !== "done";

  return (
    <div
      ref={frameRef}
      aria-hidden
      // React 19 boolean `inert`: nothing inside is focusable or clickable.
      inert
      className={cn(
        "bg-muted/40 flex h-full justify-center px-4 pt-4 sm:px-10 sm:pt-6",
        className
      )}
    >
      <div
        className={cn(
          "bg-background flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border shadow-xl shadow-black/10 dark:shadow-black/40",
          cardClassName
        )}
      >
        <ChatHeader
          nickname="Acme Assistant"
          historyOpen={false}
          onToggleHistory={noop}
          onNewChat={noop}
          onClose={noop}
          fullscreen={false}
          onToggleFullscreen={noop}
          onSendFeedback={noop}
        />

        <MessageScroller
          className="min-h-0 flex-1"
          busy={pending}
          navigation="rail"
          viewportClassName="px-4 py-4"
          contentClassName="space-y-4"
        >
          <ChatMarkdown text={WELCOME} className="text-[15px]" />

          {/* Quick replies (typed starter buttons) */}
          <div className="space-y-2 pt-1">
            <span className="border-primary text-primary flex w-full items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-center text-[15px] font-medium">
              Billing & invoices
            </span>
            <span className="text-foreground block w-full rounded-lg bg-foreground/10 px-4 py-2.5 text-center text-[15px]">
              Talk to a human
            </span>
          </div>

          <Message from="user" className="group relative">
            <MessageContent>
              <MessageBubble>
                <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
                  {USER_QUESTION}
                </MessageBubbleContent>
              </MessageBubble>
            </MessageContent>
          </Message>

          <Message from="assistant" key={`turn-${runId}`}>
            <MessageContent className="gap-2">
              <ThinkingPanel
                steps={steps}
                phase={phase}
                searchCount={2}
                active={pending}
              />
              {progress.map((line) => (
                <ProgressLine key={line} text={line} />
              ))}
              {streaming !== null && (
                <StreamingResponse status="streaming">
                  <ChatMarkdown text={streaming} />
                  <span className="animate-pulse">▍</span>
                </StreamingResponse>
              )}
              {answered && (
                <StreamingResponse
                  status="complete"
                  copyText={ANSWER_MARKDOWN}
                  sources={SOURCES}
                >
                  <ChatMarkdown text={ANSWER_MARKDOWN} />
                </StreamingResponse>
              )}
              {answered && (
                <div className="w-full max-w-[92%] pt-1">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-sm">
                      Suggested questions
                    </span>
                    <hr className="flex-1" />
                  </div>
                  <div className="mt-2 space-y-2">
                    {FOLLOW_UPS.map((question) => (
                      <span
                        key={question}
                        className="bg-background block w-full rounded-xl border px-4 py-3 text-left text-sm leading-snug"
                      >
                        {question}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </MessageContent>
          </Message>
        </MessageScroller>

        <div className="px-4 pb-4">
          <PromptInput
            value=""
            onValueChange={noop}
            onSubmit={noop}
            loading={pending}
            onStop={noop}
            minRows={1}
            maxRows={3}
            placeholder="Ask anything…"
            aria-label="Preview composer"
          />
        </div>
      </div>
    </div>
  );
}
