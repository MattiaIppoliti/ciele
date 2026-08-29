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
import { AuthorLine, type ChatAuthor } from "@/components/chat/chat-thread";
import { useShouldAnimate } from "@/components/home/use-in-viewport";
import { cn } from "@agent-hub/ui";

/* The shot on /features/teammates, played rather than framed: one scripted
   turn with a Teammate called Chief of Staff, through the same chat components
   the product uses.

   It is the sibling of `assistant-preview-demo`, and the differences are the
   point. That one is a *widget*: a stranger asking a public assistant about
   their invoice, so it carries a welcome card, quick replies, a standing
   escalation button and the AI disclaimer. This one is a colleague asking a
   colleague, so it carries none of them, and the work in the Thinking panel is
   internal work: reading the three memory layers, searching the Knowledge Scope
   it was given, and taking an action it was granted.

   Pure fixture data through the real components; nothing here talks to the
   runtime. Inert: a picture that moves, not a chat you can type into. Off
   screen or under prefers-reduced-motion it holds the finished turn instead of
   animating. */

const TEAMMATE = "Chief of Staff";

/* Who is talking. A 1:1 chat normally leaves this out, and `ChatAuthor`'s own
   docstring says why: with two participants a name above every bubble is noise.
   A picture of one is the exception. A visitor arriving here has no idea a
   Teammate has a face and a name of its own, and that is the entire claim the
   page is making, so the shot states it the way a group thread does.

   The seeds are arbitrary strings rather than ids because nothing here is a
   record; `blobatar` only needs a stable seed to draw the same face twice. */
const CHIEF_OF_STAFF: ChatAuthor = {
  name: TEAMMATE,
  title: "Teammate",
  avatarSeed: "ciele-chief-of-staff",
};

const MEMBER: ChatAuthor = {
  name: "Nadia Rossi",
  avatarSeed: "ciele-nadia-rossi",
};

const MEMBER_QUESTION =
  "What came out of last week's customer calls, and what should we fix first?";

const ANSWER_MARKDOWN = `Three things came up more than once, in the order I would fix them:

1. **Onboarding stalls at the import step.** Six of eleven calls. People get to "connect your data" and stop, because nothing says how long the import takes.
2. **Seat changes are invisible until the invoice.** Four calls. Two of them were surprised twice.
3. **Search misses exact product names.** Three calls, all on the same two SKUs.

The first one is the only one costing you activations, so I would start there.

I filed **IMP-42** for the import step and attached the four transcripts that show it. The other two already had open items, so I added the new evidence to those instead of opening duplicates.`;

const SOURCES: CitationItem[] = [
  {
    id: "c-calls",
    title: "Customer calls, week 34",
    domain: "Library · call-notes",
  },
  {
    id: "c-onboarding",
    title: "Onboarding funnel, current",
    domain: "Library · product-metrics",
  },
  {
    id: "c-improvements",
    title: "Open improvements",
    domain: "Improvements",
  },
];

const THOUGHT_TEXT =
  "Nadia wants a ranked list, not a summary. I have her note that she prefers the cost of each problem stated plainly. I will read last week's call notes from my Knowledge Scope, check what is already filed so I do not open duplicates, then rank by activations lost.";

const PROJECT_MEMO =
  "Project: Q3 activation. Goal is first-import completion above 60%.";

interface ScriptApi {
  setSteps: (update: (steps: TurnStep[]) => TurnStep[]) => void;
  setPhase: (phase: TurnPhase) => void;
  setProgress: (lines: string[]) => void;
  setStreaming: (text: string | null) => void;
  setAnswered: (answered: boolean) => void;
}

/** The scripted step sequence, (delayMs, apply) pairs run in order. */
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

  // Cut the streamed answer at stable boundaries so a numbered item never
  // appears half-written.
  const cuts = [90, 210, 330, 450, 560, ANSWER_MARKDOWN.length];

  return [
    [
      300,
      () => {
        setPhase("running");
        upsert({
          id: "n1",
          kind: "notice",
          label: "Reading memory",
          detail: `Your profile, my notes, and ${PROJECT_MEMO}`,
          status: "done",
        });
      },
    ],
    [500, () => upsert({ id: "t1", kind: "thought", label: THOUGHT_TEXT.slice(0, 62), status: "running" })],
    [650, () => upsert({ id: "t1", kind: "thought", label: THOUGHT_TEXT, status: "done" })],
    [
      420,
      () => {
        upsert({
          id: "s1",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Searching my Knowledge Scope for “customer calls, week 34”",
          status: "running",
          input: { queries: ["customer calls week 34", "onboarding drop-off"] },
        });
        setProgress(["Reading last week's call notes…"]);
      },
    ],
    [
      900,
      () => {
        upsert({
          id: "s1",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Searching my Knowledge Scope for “customer calls, week 34”",
          status: "done",
          input: { queries: ["customer calls week 34", "onboarding drop-off"] },
          detail: "11 call notes matched, 2 collections",
          durationMs: 143,
          iteration: 1,
        });
        upsert({
          id: "s2",
          kind: "tool",
          tool: "listImprovements",
          label: "Checking what is already filed",
          status: "running",
          input: { status: ["todo", "in_progress"] },
        });
        setProgress([
          "Reading last week's call notes…",
          "Checking open improvements…",
        ]);
      },
    ],
    [
      850,
      () => {
        upsert({
          id: "s2",
          kind: "tool",
          tool: "listImprovements",
          label: "Checking what is already filed",
          status: "done",
          input: { status: ["todo", "in_progress"] },
          detail: "2 of the 3 problems already have an item",
          durationMs: 96,
          iteration: 2,
        });
        upsert({
          id: "s3",
          kind: "tool",
          tool: "createImprovement",
          label: "Filing the one that is new",
          status: "running",
          input: {
            title: "Onboarding stalls at the import step",
            evidence: 4,
          },
        });
        setProgress([
          "Reading last week's call notes…",
          "Checking open improvements…",
          "Filing what is new…",
        ]);
      },
    ],
    [
      800,
      () => {
        upsert({
          id: "s3",
          kind: "tool",
          tool: "createImprovement",
          label: "Filing the one that is new",
          status: "done",
          input: {
            title: "Onboarding stalls at the import step",
            evidence: 4,
          },
          detail: "Created IMP-42, attributed to you",
          result: {
            id: "IMP-42",
            title: "Onboarding stalls at the import step",
            priority: "High",
            attributed_to: "Nadia Rossi",
          },
          durationMs: 212,
          iteration: 3,
        });
      },
    ],
    [
      550,
      () => {
        upsert({
          id: "s4",
          kind: "tool",
          tool: "readyToAnswer",
          label: "Getting ready to answer…",
          status: "done",
          result: { status: "answer" },
          durationMs: 9,
          iteration: 4,
        });
      },
    ],
    ...cuts.map(
      (cut, index): [number, () => void] => [
        index === 0 ? 450 : 240,
        () => setStreaming(ANSWER_MARKDOWN.slice(0, cut)),
      ]
    ),
    [
      400,
      () => {
        setStreaming(null);
        setAnswered(true);
        setPhase("done");
        setProgress([]);
      },
    ],
  ];
}

/** The frame every loop ends on, also the still shown before the loop has ever
 *  run (reduced motion, or the observer's first tick). */
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
const DWELL_MS = 4500;

/* One dial over the whole script's tempo, same reason as the assistant demo:
   the delays are written as the turn's shape, and at their raw speed the
   Teammate reasons faster than a reader can follow the panel. */
const PACE = 1.5;

const noop = () => {};

export function TeammateChatDemo({
  className,
  cardClassName,
}: {
  className?: string;
  cardClassName?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const active = useShouldAnimate(frameRef);

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
        /* Same card the Teammate chat draws, which is the Preview panel's:
           a filled `bg-card` pane at `rounded-xl` with a hairline border. */
        className={cn(
          "bg-card flex w-full max-w-lg flex-col overflow-hidden rounded-xl border",
          cardClassName
        )}
      >
        {/* The Teammate chat's own header: its name, and nothing about a
            visitor. No launcher close button, because this chat lives on a
            page rather than floating over someone else's site. */}
        <ChatHeader
          nickname={TEAMMATE}
          historyOpen={false}
          onToggleHistory={noop}
          onNewChat={noop}
          fullscreen={false}
          onToggleFullscreen={noop}
        />

        <MessageScroller
          className="min-h-0 flex-1"
          busy={pending}
          navigation="rail"
          viewportClassName="px-4 py-5"
          contentClassName="space-y-4"
        >
          {/* Straight into the question. A Teammate has no welcome card and no
              quick replies: you already know who you are talking to, and the
              two of you have talked before. */}
          <Message from="user" className="group relative">
            <MessageContent>
              <AuthorLine author={MEMBER} />
              <MessageBubble>
                <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
                  {MEMBER_QUESTION}
                </MessageBubbleContent>
              </MessageBubble>
            </MessageContent>
          </Message>

          <Message from="assistant" key={`turn-${runId}`}>
            <MessageContent className="gap-2">
              <AuthorLine author={CHIEF_OF_STAFF} />
              <ThinkingPanel
                steps={steps}
                phase={phase}
                searchCount={1}
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
            </MessageContent>
          </Message>
        </MessageScroller>

        {/* Composer, and only the composer. The widget's foot carries a
            standing escalation button and an AI disclaimer; a colleague needs
            neither, and drawing them here would be a picture of the wrong
            surface. */}
        <div className="px-4 pb-4">
          <PromptInput
            value=""
            onValueChange={noop}
            onSubmit={noop}
            loading={pending}
            onStop={noop}
            minRows={1}
            maxRows={3}
            placeholder={`Ask ${TEAMMATE}...`}
            aria-label="Teammate composer"
          />
        </div>
      </div>
    </div>
  );
}
