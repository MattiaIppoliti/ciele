"use client";

import { useEffect, useRef, useState } from "react";
import { Hash, UserRoundPlus } from "lucide-react";
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
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { AuthorLine, type ChatAuthor } from "@/components/chat/chat-thread";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { useShouldAnimate } from "@/components/home/use-in-viewport";
import { cn } from "@/lib/utils";

/* The coda shot on /features/teammates: a group, where one message reaches
   several colleagues at once.

   The hero above it is a 1:1 chat, and this is the claim the hero cannot make:
   a Teammate is not a private assistant each person keeps to themselves. Name
   two in a room and two answer, each from its own Knowledge Scope, each with
   its own face on its own reply.

   Same components as the product's channel: the `#` heading with its people /
   teammates line, the overlapping roster faces at the right, `AuthorLine` above
   every bubble, mention chips inside the one that summoned them.

   Pure fixture data, inert, and looping only while it is on screen. Under
   prefers-reduced-motion it holds the finished thread. */

const GROUP = "Release 4.2";

/* Deliberately not the Chief of Staff from the hero. The page has just shown
   one Teammate answering alone; the point here is that a room holds several,
   and reusing the same name would blunt it. Seeds are arbitrary stable strings,
   `blobatar` needs nothing else to draw the same face twice. */
const SUPPORT_LEAD: ChatAuthor = {
  name: "Support Lead",
  title: "Teammate",
  avatarSeed: "ciele-support-lead",
};

const RELEASE_MANAGER: ChatAuthor = {
  name: "Release Manager",
  title: "Teammate",
  avatarSeed: "ciele-release-manager",
};

const NADIA: ChatAuthor = {
  name: "Nadia Rossi",
  avatarSeed: "ciele-nadia-rossi",
};

const TOMAS: ChatAuthor = {
  name: "Tomás Varga",
  avatarSeed: "ciele-tomas-varga",
};

const PRIYA: ChatAuthor = {
  name: "Priya Nair",
  avatarSeed: "ciele-priya-nair",
};

/** The room, in the order the header draws it: people first, then Teammates. */
const ROSTER = [
  { id: "p1", seed: NADIA.avatarSeed },
  { id: "p2", seed: TOMAS.avatarSeed },
  { id: "p3", seed: PRIYA.avatarSeed },
  { id: "t1", seed: SUPPORT_LEAD.avatarSeed },
  { id: "t2", seed: RELEASE_MANAGER.avatarSeed },
];

const QUESTION_LEAD = "What is still blocking 4.2? ";
const QUESTION_TAIL = " ";

/* People talk here too, and to each other. A room where the humans only ever
   prompt and the agents only ever answer is a help desk with extra faces; the
   thread that makes the point is one where a colleague reads what a Teammate
   found, takes the work, and somebody else closes the decision. */
const TOMAS_REPLY =
  "The importer change is mine. If the migration is the blocker I can ship a fallback for the two big tenants today.";

const PRIYA_REPLY =
  "Then hold the tag. Tomás ships the fallback, I move the date to Thursday and tell the two accounts.";

/* Both answers are short on purpose. The card is one picture on a marketing
   page, and the claim it makes is "two colleagues answered", which the reader
   gets from two faces and two voices. A wall of text pushes the second face
   below the fold and takes the claim with it. */
const SUPPORT_ANSWER = `Two, from this week's tickets. **Import times out above 50k rows**, nine of them, all retried and succeeded. And **two help articles still link the old API key screen**.

Neither is new in 4.2, but the first gets worse with the new importer.`;

const RELEASE_ANSWER = `One blocker: the migration that widens \`workspace_id\` has not run on the two largest tenants, and it is the one the importer needs. So Support Lead's first point and this are the same problem.

I would hold the tag until it lands.`;

const THOUGHT_SUPPORT =
  "Nadia is asking what blocks the release, so she wants the things that stop a tag going out, not every open ticket. I will read this week's tickets and keep only what is reproducible.";

/** Who speaks, in order: two Teammates and the two people who reply to them. */
type Turn = "a" | "b" | "tomas" | "priya";

interface ScriptApi {
  setSteps: (id: "a" | "b", update: (steps: TurnStep[]) => TurnStep[]) => void;
  setPhase: (id: "a" | "b", phase: TurnPhase) => void;
  setAnswered: (id: "a" | "b", answered: boolean) => void;
  setVisible: (id: Turn, visible: boolean) => void;
}

/** The scripted sequence, (delayMs, apply) pairs run in order. */
function buildScript(api: ScriptApi): Array<[number, () => void]> {
  const { setSteps, setPhase, setAnswered, setVisible } = api;
  const upsert = (who: "a" | "b", step: TurnStep) =>
    setSteps(who, (steps) => {
      const index = steps.findIndex((s) => s.id === step.id);
      if (index === -1) return [...steps, step];
      const next = [...steps];
      next[index] = step;
      return next;
    });

  return [
    // Support Lead goes first: it was named first.
    [400, () => setVisible("a", true)],
    [
      450,
      () => {
        setPhase("a", "running");
        upsert("a", {
          id: "a-t",
          kind: "thought",
          label: THOUGHT_SUPPORT,
          status: "done",
        });
      },
    ],
    [
      500,
      () =>
        upsert("a", {
          id: "a-s",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Reading this week's support tickets",
          status: "running",
          input: { queries: ["4.2 blockers", "import timeout"] },
        }),
    ],
    [
      900,
      () =>
        upsert("a", {
          id: "a-s",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Reading this week's support tickets",
          status: "done",
          input: { queries: ["4.2 blockers", "import timeout"] },
          detail: "13 tickets matched",
          durationMs: 118,
          iteration: 1,
        }),
    ],
    [
      600,
      () => {
        setAnswered("a", true);
        setPhase("a", "done");
      },
    ],
    // A person reads what the Teammate found and takes the work. This is the
    // beat that makes it a room rather than a queue.
    [900, () => setVisible("tomas", true)],
    // Then Release Manager, on the same original message. Nobody prompted it
    // again: it was named once, at the top.
    [800, () => setVisible("b", true)],
    [
      450,
      () => {
        setPhase("b", "running");
        upsert("b", {
          id: "b-s",
          kind: "tool",
          tool: "queryApi",
          label: "Checking migration status per tenant",
          status: "running",
          input: { path: "/deploys/migrations", parameters: { release: "4.2" } },
        });
      },
    ],
    [
      950,
      () =>
        upsert("b", {
          id: "b-s",
          kind: "tool",
          tool: "queryApi",
          label: "Checking migration status per tenant",
          status: "done",
          input: { path: "/deploys/migrations", parameters: { release: "4.2" } },
          detail: "Pending on 2 of 214 tenants",
          durationMs: 240,
          iteration: 1,
        }),
    ],
    [
      600,
      () => {
        setAnswered("b", true);
        setPhase("b", "done");
      },
    ],
    // And a person closes it. The activity the room came together to do is
    // finished by the people in it, not by the agents.
    [900, () => setVisible("priya", true)],
  ];
}

/** The frame the loop ends on, and the still shown under reduced motion. */
const FINAL = (() => {
  const steps: Record<"a" | "b", TurnStep[]> = { a: [], b: [] };
  for (const [, apply] of buildScript({
    setSteps: (id, update) => {
      steps[id] = update(steps[id]);
    },
    setPhase: () => {},
    setAnswered: () => {},
    setVisible: () => {},
  })) {
    apply();
  }
  return steps;
})();

const DWELL_MS = 5000;
const PACE = 1.4;

const noop = () => {};

/** One person's message: their face, their name, their words. */
function PersonSays({ author, text }: { author: ChatAuthor; text: string }) {
  return (
    <Message from="user" className="group relative">
      <MessageContent>
        <AuthorLine author={author} />
        <MessageBubble>
          <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
            {text}
          </MessageBubbleContent>
        </MessageBubble>
      </MessageContent>
    </Message>
  );
}

/** One Teammate's reply in the thread: its face, its name, its work, its answer. */
function Reply({
  author,
  steps,
  phase,
  answered,
  markdown,
  runId,
}: {
  author: ChatAuthor;
  steps: TurnStep[];
  phase: TurnPhase;
  answered: boolean;
  markdown: string;
  runId: number;
}) {
  return (
    <Message from="assistant" key={`${author.name}-${runId}`}>
      <MessageContent className="gap-2">
        <AuthorLine author={author} />
        <ThinkingPanel
          steps={steps}
          phase={phase}
          searchCount={1}
          active={phase !== "done"}
        />
        {answered && (
          <StreamingResponse status="complete" copyText={markdown}>
            <ChatMarkdown text={markdown} />
          </StreamingResponse>
        )}
      </MessageContent>
    </Message>
  );
}

export function GroupChatDemo({ className }: { className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const active = useShouldAnimate(frameRef);

  const [stepsA, setStepsA] = useState<TurnStep[]>(FINAL.a);
  const [stepsB, setStepsB] = useState<TurnStep[]>(FINAL.b);
  const [phaseA, setPhaseA] = useState<TurnPhase>("done");
  const [phaseB, setPhaseB] = useState<TurnPhase>("done");
  const [answeredA, setAnsweredA] = useState(true);
  const [answeredB, setAnsweredB] = useState(true);
  const [visibleA, setVisibleA] = useState(true);
  const [visibleB, setVisibleB] = useState(true);
  const [visibleTomas, setVisibleTomas] = useState(true);
  const [visiblePriya, setVisiblePriya] = useState(true);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        setStepsA([]);
        setStepsB([]);
        setPhaseA("running");
        setPhaseB("running");
        setAnsweredA(false);
        setAnsweredB(false);
        setVisibleA(false);
        setVisibleB(false);
        setVisibleTomas(false);
        setVisiblePriya(false);
      }, 0)
    );

    const set = {
      a: { steps: setStepsA, phase: setPhaseA, answered: setAnsweredA, visible: setVisibleA },
      b: { steps: setStepsB, phase: setPhaseB, answered: setAnsweredB, visible: setVisibleB },
    } as const;
    const show = {
      a: setVisibleA,
      b: setVisibleB,
      tomas: setVisibleTomas,
      priya: setVisiblePriya,
    } as const;

    let at = 0;
    for (const [delay, apply] of buildScript({
      setSteps: (id, update) => set[id].steps(update),
      setPhase: (id, phase) => set[id].phase(phase),
      setAnswered: (id, answered) => set[id].answered(answered),
      setVisible: (id, visible) => show[id](visible),
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

  const pending = phaseA !== "done" || phaseB !== "done";

  return (
    <div
      ref={frameRef}
      aria-hidden
      data-foley-silent=""
      inert
      className={cn("mx-auto w-full max-w-3xl", className)}
    >
      {/* Tall enough that the whole exchange fits without the transcript
          scrolling: the question with its mention chips is the setup, and a
          card that auto-scrolls past it shows answers to nothing. Measured
          against the finished five-turn thread, which is the tallest it gets. */}
      <div className="bg-card flex h-[820px] flex-col overflow-hidden rounded-2xl border">
        {/* The channel header, class for class: the hash and the name, the
            people/teammates line under it, and the room's faces overlapping at
            the right. */}
        <div className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Hash className="text-muted-foreground size-4 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{GROUP}</p>
              <p className="text-muted-foreground truncate text-xs">
                3 people · 2 teammates
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* The margin rides the avatar itself rather than a wrapper, so the
                overlap stays on the sized element. */}
            <div className="hidden items-center sm:flex">
              {ROSTER.map((face) => (
                <GeneratedAvatar
                  key={face.id}
                  seed={face.seed}
                  size="size-7"
                  className="ring-background -ml-2 block ring-2 first:ml-0"
                />
              ))}
            </div>
            <span className="border-input text-muted-foreground flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs">
              <UserRoundPlus className="size-3.5" /> Add
            </span>
          </div>
        </div>

        <MessageScroller
          className="min-h-0 flex-1"
          busy={pending}
          navigation="rail"
          viewportClassName="px-4 py-5"
          contentClassName="space-y-4"
        >
          <Message from="user" className="group relative">
            <MessageContent>
              <AuthorLine author={NADIA} />
              <MessageBubble>
                <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
                  {/* Mention chips, drawn the way a posted channel message
                      draws them: the face of whoever was named, then the name,
                      on a pill tinted from the bubble's own text colour. */}
                  <span className="whitespace-pre-wrap">{QUESTION_LEAD}</span>
                  <MentionChip author={SUPPORT_LEAD} />
                  <span className="whitespace-pre-wrap">{QUESTION_TAIL}</span>
                  <MentionChip author={RELEASE_MANAGER} />
                </MessageBubbleContent>
              </MessageBubble>
            </MessageContent>
          </Message>

          {visibleA && (
            <Reply
              author={SUPPORT_LEAD}
              steps={stepsA}
              phase={phaseA}
              answered={answeredA}
              markdown={SUPPORT_ANSWER}
              runId={runId}
            />
          )}
          {visibleTomas && <PersonSays author={TOMAS} text={TOMAS_REPLY} />}
          {visibleB && (
            <Reply
              author={RELEASE_MANAGER}
              steps={stepsB}
              phase={phaseB}
              answered={answeredB}
              markdown={RELEASE_ANSWER}
              runId={runId}
            />
          )}
          {visiblePriya && <PersonSays author={PRIYA} text={PRIYA_REPLY} />}
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
            placeholder="Write @ to ask a teammate…"
            aria-label="Group composer"
          />
          <p className="text-muted-foreground mt-3 text-xs leading-snug">
            Teammates answer when you name them with @. One message runs at most
            10 teammate replies.
          </p>
        </div>
      </div>
    </div>
  );
}

/** A named colleague inside a posted message. Mirrors `MentionText`'s chip. */
function MentionChip({ author }: { author: ChatAuthor }) {
  return (
    <span className="bg-current/20 mx-0.5 inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 align-middle">
      <GeneratedAvatar seed={author.avatarSeed} size="size-3.5" />
      <span className="truncate font-medium">{author.name}</span>
    </span>
  );
}
