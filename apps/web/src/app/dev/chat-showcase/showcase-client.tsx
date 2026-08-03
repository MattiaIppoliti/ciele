"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TurnPhase, TurnStep } from "@agent-hub/agent/client";
import { ExternalLink, HelpCircle } from "lucide-react";
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
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { ProgressLine } from "@/components/chat/progress-line";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { ChatHeader } from "@/components/chat/chat-header";

/**
 * Dev-only visual showcase (#beui restyle): one scripted, hypothetical
 * conversation that walks through every chat component in sequence —
 * quick replies, the brand user bubble, the Thinking panel (notice row,
 * streamed thought, Todo List plan, ToolResult with the shiki terminal,
 * the readyToAnswer feather), Simplified-thinking progress lines, streamed
 * markdown with a CodeBlock fence, the sources disclosure (book vs globe
 * icons), typed buttons, follow-ups, a proactive notification, a clarify
 * card, the PromptInput composer and the conversations-only AI Sidebar.
 *
 * Pure fixture data through the real components; nothing here talks to the
 * runtime. Type a message (or press Replay) to run the script again.
 */

const ANSWER_MARKDOWN = `Le tasse per il **MSc in Management** (a.y. 2026/27) sono **€ 15.200**, divise in tre rate.

- Prima rata: **€ 6.000** — entro il 30 settembre
- Seconda rata: **€ 5.000** — entro il 15 gennaio
- Terza rata: **€ 4.200** — entro il 30 aprile

Il record recuperato dall'API studenti:

\`\`\`json
{
  "student_id": "42",
  "program": "MSc Management",
  "tuition_eur": 15200,
  "installments": [6000, 5000, 4200],
  "scholarship": null
}
\`\`\`

Se hai una borsa di studio attiva, l'importo viene ricalcolato dopo la prima rata.`;

const SOURCES: CitationItem[] = [
  {
    id: "c-fees",
    title: "Tuition & fees 2026/27",
    domain: "Regolamenti · fees-2026.pdf",
  },
  {
    id: "c-installments",
    title: "Piano rate e scadenze",
    domain: "Regolamenti · fees-2026.pdf",
  },
  {
    id: "c-scholarship",
    title: "Borse di studio — riduzioni",
    domain: "Regolamenti · dsu-guide.pdf",
  },
  {
    id: "c-web-fees",
    title: "Fees — university website",
    domain: "Sito ateneo",
    url: "https://example.edu/admissions/fees",
  },
  {
    id: "c-web-deadlines",
    title: "Academic deadlines",
    domain: "Sito ateneo",
    url: "https://example.edu/calendar/deadlines",
  },
];

const HISTORY: SidebarResource[] = [
  {
    id: "day:Today",
    label: "Today",
    kind: "folder",
    children: [
      { id: "conv-1", label: "Tasse MSc Management", kind: "file" },
      { id: "conv-2", label: "Scadenze iscrizione esami", kind: "file" },
    ],
  },
  {
    id: "day:Yesterday",
    label: "Yesterday",
    kind: "folder",
    children: [
      { id: "conv-3", label: "Orari biblioteca e aule studio", kind: "file" },
    ],
  },
];

const THOUGHT_TEXT =
  "The visitor asks about tuition fees for the MSc in Management. I should read the fees pack, cross-check the student-records API, then answer with citations.";

/** The scripted step sequence — (delayMs, apply) pairs run in order. */
function buildScript(api: {
  setSteps: (update: (steps: TurnStep[]) => TurnStep[]) => void;
  setPhase: (phase: TurnPhase) => void;
  setProgress: (lines: string[]) => void;
  setStreaming: (text: string | null) => void;
  setAnswered: (answered: boolean) => void;
  setExtras: (shown: boolean) => void;
}): Array<[number, () => void]> {
  const { setSteps, setPhase, setProgress, setStreaming, setAnswered, setExtras } =
    api;
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
    upsert({ id: "p1", kind: "step", stage: "search", label: "Read the fees knowledge pack", status: read });
    upsert({ id: "p2", kind: "step", stage: "search", label: "Query the student-records API", status: query });
    upsert({ id: "p3", kind: "step", stage: "generate", label: "Draft the answer with citations", status: draft });
  };

  // Streamed markdown: cut at stable boundaries so the fence closes late.
  const cuts = [90, 180, 260, 330, 420, 520, ANSWER_MARKDOWN.length];

  return [
    [200, () => {
      setPhase("running");
      upsert({ id: "n1", kind: "notice", label: "Classifying intent", detail: "Matched flow “Fees & payments”", status: "done" });
    }],
    [600, () => upsert({ id: "t1", kind: "thought", label: THOUGHT_TEXT.slice(0, 60), status: "running" })],
    [700, () => upsert({ id: "t1", kind: "thought", label: THOUGHT_TEXT, status: "done" })],
    [500, () => plan("running", "done", "done")],
    [300, () => {
      plan("running", "running", "running");
      upsert({
        id: "s1", kind: "tool", tool: "searchKnowledge",
        label: "Searching knowledge for “tuition fees MSc Management”",
        status: "running",
        input: { queries: ["tuition fees MSc Management", "piano rate 2026/27"] },
      });
      setProgress(["Sto cercando nel regolamento tasse…"]);
    }],
    [900, () => {
      plan("done", "running", "running");
      upsert({
        id: "s1", kind: "tool", tool: "searchKnowledge",
        label: "Searching knowledge for “tuition fees MSc Management”",
        status: "done",
        input: { queries: ["tuition fees MSc Management", "piano rate 2026/27"] },
        detail: "3 concepts matched — fees-2026.pdf, dsu-guide.pdf",
        durationMs: 128,
        iteration: 1,
      });
      upsert({
        id: "s2", kind: "tool", tool: "queryApi",
        label: "Querying the student-records API",
        status: "running",
        input: { path: "/students/{id}/fees", parameters: { id: "42" } },
      });
      setProgress([
        "Sto cercando nel regolamento tasse…",
        "Sto controllando il tuo piano rate…",
      ]);
    }],
    [1000, () => {
      plan("done", "done", "running");
      upsert({
        id: "s2", kind: "tool", tool: "queryApi",
        label: "Querying the student-records API",
        status: "done",
        input: { path: "/students/{id}/fees", parameters: { id: "42" } },
        detail: "Fetched the fee record",
        result: {
          endpoint: "/students/42/fees",
          method: "GET",
          status: 200,
          response:
            '{\n  "student_id": "42",\n  "program": "MSc Management",\n  "tuition_eur": 15200,\n  "installments": [6000, 5000, 4200],\n  "scholarship": null\n}',
        },
        durationMs: 342,
        iteration: 2,
      });
    }],
    [700, () => {
      plan("done", "done", "done");
      upsert({
        id: "s3", kind: "tool", tool: "readyToAnswer",
        label: "Getting ready to answer…",
        status: "done",
        result: { status: "answer" },
        durationMs: 12,
        iteration: 3,
      });
    }],
    ...cuts.map(
      (cut, index): [number, () => void] => [
        index === 0 ? 500 : 260,
        () => setStreaming(ANSWER_MARKDOWN.slice(0, cut)),
      ]
    ),
    [400, () => {
      setStreaming(null);
      setAnswered(true);
      setPhase("done");
      setProgress([]);
    }],
    [1100, () => setExtras(true)],
  ];
}

export function ChatShowcase() {
  const [userText, setUserText] = useState(
    "Quanto sono le tasse per il MSc in Management?"
  );
  const [steps, setSteps] = useState<TurnStep[]>([]);
  const [phase, setPhase] = useState<TurnPhase>("running");
  const [progress, setProgress] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [extras, setExtras] = useState(false);
  const [started, setStarted] = useState(false);
  // Remounts the scripted turn per replay, so the panel's elapsed clock and
  // entrance animations start fresh each run.
  const [runId, setRunId] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [draft, setDraft] = useState("");
  const timers = useRef<number[]>([]);

  const replay = useCallback((question?: string) => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    if (question) setUserText(question);
    setSteps([]);
    setPhase("running");
    setProgress([]);
    setStreaming(null);
    setAnswered(false);
    setExtras(false);
    setFeedback(null);
    setStarted(true);
    setRunId((run) => run + 1);
    let at = 0;
    for (const [delay, apply] of buildScript({
      setSteps,
      setPhase,
      setProgress,
      setStreaming,
      setAnswered,
      setExtras,
    })) {
      at += delay;
      timers.current.push(window.setTimeout(apply, at));
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the effect body itself never calls setState.
    const kickoff = window.setTimeout(() => replay(), 0);
    const pending = timers.current;
    return () => {
      window.clearTimeout(kickoff);
      for (const timer of pending) window.clearTimeout(timer);
    };
  }, [replay]);

  const pending = started && phase !== "done";

  return (
    <div className="mx-auto flex h-screen max-w-xl flex-col border-x bg-background text-foreground">
      <ChatHeader
        nickname="Demo AI"
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen(!historyOpen)}
        onNewChat={() => replay()}
        onClose={() => setHistoryOpen(false)}
        fullscreen={false}
        onToggleFullscreen={() => {}}
        onSendFeedback={() => {}}
      />

      {historyOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-4">
            <span className="text-primary border-primary inline-block border-b-2 px-1 pt-3 pb-2 text-sm font-semibold">
              My conversations
            </span>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto px-2 py-2">
            <AISidebar
              items={HISTORY}
              activeId="conv-1"
              defaultExpandedIds={HISTORY.map((group) => group.id)}
              onActiveChange={(id) => {
                if (!id.startsWith("day:")) setHistoryOpen(false);
              }}
              ariaLabel="My conversations"
              className='w-full [&_button[aria-label^="Actions for"]]:hidden'
            />
          </div>
        </div>
      ) : (
        <>
          <MessageScroller
            className="min-h-0 flex-1"
            busy={pending}
            navigation="rail"
            viewportClassName="px-4 py-5"
            contentClassName="space-y-4"
          >
            <ChatMarkdown
              text="Ciao! Sono l'assistente demo — questa conversazione è **sceneggiata** per mostrare ogni componente della nuova chat."
              className="text-[15px]"
            />

            {/* Quick replies (typed starter buttons) */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => replay("Quanto sono le tasse per il MSc in Management?")}
                className="border-primary text-primary flex w-full items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-center text-[15px] font-medium transition-colors hover:bg-muted"
              >
                Tasse e rate
              </button>
              <button
                type="button"
                onClick={() => replay("Che scadenze ho questo mese?")}
                className="text-foreground w-full rounded-lg bg-foreground/10 px-4 py-2.5 text-center text-[15px] transition-colors hover:bg-foreground/15"
              >
                Che scadenze ho questo mese?
              </button>
            </div>

            {started && (
              <Message from="user" animateIn className="group relative">
                <MessageContent>
                  <MessageBubble>
                    <MessageBubbleContent className="max-w-[85%] text-primary-foreground [&>span[aria-hidden]]:bg-primary">
                      {userText}
                    </MessageBubbleContent>
                  </MessageBubble>
                </MessageContent>
              </Message>
            )}

            {started && (
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
                      feedback={feedback}
                      onFeedbackChange={setFeedback}
                    >
                      <ChatMarkdown text={ANSWER_MARKDOWN} />
                    </StreamingResponse>
                  )}
                  {answered && (
                    <a
                      href="https://example.edu/admissions/fees"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-primary text-primary-foreground inline-flex max-w-[90%] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                    >
                      Apri la pagina tasse
                      <ExternalLink className="size-3.5" />
                    </a>
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
                        {[
                          "Come richiedo la riduzione per borsa di studio?",
                          "Posso pagare con PagoPA?",
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => replay(q)}
                            className="w-full rounded-xl border bg-background px-4 py-3 text-left text-sm leading-snug transition-colors hover:bg-muted"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </MessageContent>
              </Message>
            )}

            {extras && (
              <Message from="assistant" animateIn>
                <MessageContent className="gap-2">
                  {/* Proactive notification (accent edge) */}
                  <MessageBubble>
                    <MessageBubbleContent
                      className="max-w-[90%] space-y-1 border-l-2 border-l-primary bg-muted/60 [&>span[aria-hidden]]:bg-transparent"
                    >
                      <p className="font-medium">Promemoria scadenza</p>
                      <ChatMarkdown text="La **prima rata** scade il 30 settembre — mancano 12 giorni." />
                    </MessageBubbleContent>
                  </MessageBubble>
                  {/* Clarify card (agentic search terminal question) */}
                  <div className="bg-muted/40 max-w-[90%] rounded-2xl rounded-tl-sm border border-dashed px-3.5 py-2.5 text-sm">
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <HelpCircle className="size-4" />
                      <span className="text-xs font-medium">Quick question first</span>
                    </div>
                    <p className="mt-1.5">
                      Sei iscritto al primo anno o a un anno successivo?
                    </p>
                    <div className="text-muted-foreground mt-2 text-xs">
                      <span>Here&apos;s what I did find:</span>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        <li>Piano rate standard 2026/27</li>
                        <li>Riduzioni per merito (ISEE &lt; 24.000)</li>
                      </ul>
                    </div>
                  </div>
                </MessageContent>
              </Message>
            )}
          </MessageScroller>

          <div className="px-4 pb-4">
            <div className="flex justify-center pb-3">
              <button
                type="button"
                onClick={() => replay()}
                className="bg-muted hover:bg-muted/80 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors"
              >
                Replay showcase
              </button>
            </div>
            <PromptInput
              value={draft}
              onValueChange={setDraft}
              onSubmit={(value) => {
                setDraft("");
                replay(value);
              }}
              loading={pending}
              onStop={() => {
                for (const timer of timers.current) window.clearTimeout(timer);
                setPhase("done");
                setStreaming(null);
                setAnswered(true);
              }}
              minRows={1}
              maxRows={6}
              placeholder="Scrivi qualsiasi cosa — la demo riparte…"
              aria-label="Showcase composer"
            />
            <p className="text-muted-foreground mt-3 text-xs leading-snug">
              Demo sceneggiata — nessun modello viene chiamato.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
