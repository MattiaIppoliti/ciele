"use client";

import type { ReactNode } from "react";
import type { TurnStep } from "@agent-hub/agent/client";
import { Hint } from "@agent-hub/ui";
import { StepIcon, formatToolName } from "./tool-icons";
import {
  ToolResult,
  ToolResultOutput,
  type ToolResultStatus,
} from "@/components/agents/tool-result";
import {
  TodoList,
  type TodoItem,
  type TodoItemStatus,
} from "@/components/agents/todo-list";

/**
 * The Thinking panel's body: the same vertical timeline of one turn's steps
 * as before — per-step icon (tool-icons.tsx) linked by a connector line —
 * with the beui agent components rendering what each row expands into:
 *
 * - tool calls → a beui ToolResult disclosure (live status, roll-swapped
 *   labels, copy) whose body shows the call's Input / structured result /
 *   Output through the shared shiki AgentCode surface;
 * - reasoning thoughts → streamed italic text with a live cursor (#584);
 * - legacy plan stages (`kind: "step"` runs) → a beui Todo List with
 *   morphing status marks.
 *
 * Everything shown here was already deemed safe client-side by
 * runtime/tools.ts — never raw secrets.
 */

/**
 * A `status` row on a tool result. Two kinds share the key: HTTP outcomes (a
 * number, or the string `"failed"` a refused call records — it never reached
 * the network, so inventing a status would be a lie) get a pass/fail badge;
 * anything else is a declaration, not an outcome — the terminal tool's
 * `answer` / `needs_clarification` / `insufficient_information` — where
 * failure iconography would misread an honest "I'm ready to answer".
 */
function StatusBadge({ value }: { value: unknown }) {
  const status = typeof value === "number" ? value : null;
  if (status === null && value !== "failed") {
    const answered = value === "answer";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs ${
          answered
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {answered && "✅"} {String(value)}
      </span>
    );
  }
  const ok = status !== null && status >= 200 && status < 300;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs ${
        ok
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {ok ? "✅" : "⚠️"} {status ?? String(value)}
    </span>
  );
}

type TimelineEntry =
  | { type: "row"; step: TurnStep }
  | { type: "plan"; steps: TurnStep[] };

/**
 * Runs of two or more legacy plan stages (`kind: "step"`) collapse into one
 * Todo List entry; everything else stays a timeline row of its own.
 */
function groupTimeline(steps: TurnStep[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const step of steps) {
    const last = entries[entries.length - 1];
    if (step.kind === "step") {
      if (last?.type === "plan") {
        last.steps.push(step);
        continue;
      }
      entries.push({ type: "plan", steps: [step] });
      continue;
    }
    entries.push({ type: "row", step });
  }
  // A lone stage reads better as a plain row than a one-item checklist.
  return entries.map((entry) =>
    entry.type === "plan" && entry.steps.length === 1
      ? { type: "row", step: entry.steps[0] }
      : entry
  );
}

function todoStatus(status: TurnStep["status"]): TodoItemStatus {
  if (status === "running") return "in-progress";
  if (status === "error") return "cancelled";
  return "completed";
}

function toolStatus(status: TurnStep["status"]): ToolResultStatus {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "success";
}

/** First line of a (possibly multi-line) label — headers are one-liners. */
function firstLine(label: string): string {
  return label.split("\n")[0].trim();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** What a tool call's disclosure shows: Input / structured result / Output. */
function ToolStepBody({ step }: { step: TurnStep }) {
  const hasInput = Boolean(step.input && Object.keys(step.input).length > 0);
  const resultRows = Object.entries(step.result ?? {});
  return (
    <div className="space-y-2 text-xs">
      {hasInput && (
        <div>
          <p className="mb-1 text-muted-foreground/80">Input</p>
          <ToolResultOutput language="json">
            {JSON.stringify(step.input, null, 2)}
          </ToolResultOutput>
        </div>
      )}
      {/* A structured result reads as labelled rows — Endpoint, Method,
          Status, Response — rather than a JSON blob. `status` gets a
          pass/fail badge; a response body is the one row that can run to
          thousands of characters (spec #559), and the ToolResult viewport
          already scrolls it. */}
      {resultRows.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <p className="w-20 shrink-0 text-muted-foreground/80 capitalize">
            {key}
          </p>
          {key === "status" ? (
            <StatusBadge value={value} />
          ) : (
            <div className="min-w-0 flex-1">
              <ToolResultOutput
                language={typeof value === "string" ? "text" : "json"}
              >
                {asText(value)}
              </ToolResultOutput>
            </div>
          )}
        </div>
      ))}
      {step.detail && (
        <div>
          <p className="mb-1 text-muted-foreground/80">Output</p>
          <ToolResultOutput language="text">{step.detail}</ToolResultOutput>
        </div>
      )}
    </div>
  );
}

function toolCopyText(step: TurnStep): string | undefined {
  const response = step.result?.response;
  if (response !== undefined) return asText(response);
  return step.detail || undefined;
}

function toolMeta(step: TurnStep): string | undefined {
  const parts = [
    step.iteration !== undefined && `iteration ${step.iteration}`,
    step.durationMs !== undefined && `${step.durationMs}ms`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function ToolStepRow({ step }: { step: TurnStep }) {
  const hasBody = Boolean(
    (step.input && Object.keys(step.input).length > 0) ||
      Object.keys(step.result ?? {}).length > 0 ||
      step.detail
  );
  if (!hasBody) {
    // Nothing to disclose — the one-line label row, exactly as before.
    return <PlainStepRow step={step} />;
  }
  const title = firstLine(step.label);
  return (
    <ToolResult
      // The timeline column already carries the step's icon.
      icon={<span />}
      tool={step.tool ? formatToolName(step.tool) : ""}
      // The header truncates a long label; hovering it shows the whole line
      // through the same Hint tooltip the chat header buttons use.
      title={
        <Hint label={title} side="top">
          <span>{title}</span>
        </Hint>
      }
      status={toolStatus(step.status)}
      meta={toolMeta(step)}
      defaultOpen={false}
      copyText={toolCopyText(step)}
      className="-mt-1"
    >
      <ToolStepBody step={step} />
    </ToolResult>
  );
}

function PlainStepRow({ step }: { step: TurnStep }) {
  // A thought still being streamed (#584): text being written live.
  const streamingThought = step.kind === "thought" && step.status === "running";
  return (
    <p
      className={`text-[13px] leading-relaxed text-muted-foreground ${
        step.kind === "thought" ? "italic whitespace-pre-wrap" : ""
      } ${
        // A running tool label pulses; a streaming thought is text being
        // written — it gets a cursor, not a blink.
        step.status === "running" && !streamingThought ? "animate-pulse" : ""
      }`}
    >
      {step.label}
      {streamingThought && <span className="animate-pulse not-italic">▍</span>}
      {step.status === "error" && (
        <span className="text-destructive"> (failed)</span>
      )}
    </p>
  );
}

export function ThinkingTimeline({
  steps,
  className,
}: {
  steps: TurnStep[];
  className?: string;
}) {
  const entries = groupTimeline(steps);

  return (
    <div className={className}>
      {entries.map((entry, i) => {
        const isLast = i === entries.length - 1;
        const iconStep = entry.type === "plan" ? entry.steps[0] : entry.step;
        let content: ReactNode;
        if (entry.type === "plan") {
          const items: TodoItem[] = entry.steps.map((step) => ({
            id: step.id,
            title: firstLine(step.label),
            status: todoStatus(step.status),
          }));
          content = (
            <TodoList items={items} title="Plan" className="-mt-1" />
          );
        } else if (entry.step.kind === "tool") {
          content = <ToolStepRow step={entry.step} />;
        } else {
          content = <PlainStepRow step={entry.step} />;
        }

        return (
          <div
            key={entry.type === "plan" ? `plan-${iconStep.id}` : iconStep.id}
            className="flex gap-2.5"
          >
            <div className="flex flex-col items-center">
              <StepIcon step={iconStep} className="size-6" />
              {!isLast && <div className="my-0.5 w-px flex-1 bg-border" />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-3"}`}>
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
