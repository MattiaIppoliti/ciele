"use client";

import { useRef, useState } from "react";
import { Database, Send, Settings2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Label } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { updateDataAssistantEntitiesAction } from "@/app/actions";

interface EntityOption {
  id: string;
  name: string;
  description: string;
  scope: "shared" | "user";
}

/** One completed or running tool call, shown per answer for auditability. */
interface ToolCall {
  callId: string;
  label: string;
  summary?: string;
  ok?: boolean;
}

interface AssistantTurn {
  role: "assistant";
  text: string;
  tools: ToolCall[];
  pending: boolean;
}
interface UserTurn {
  role: "user";
  text: string;
}
type Turn = UserTurn | AssistantTurn;

/**
 * The data assistant chat (#668): a member-only conversation over the org's
 * imported Records. Every answer lists the tool calls that produced it, so
 * a figure is always auditable. Admins pick the queryable Entities inline.
 */
export function DataAssistantClient({
  entities,
  selectedIds,
  canManage,
  hasAssistant,
}: {
  entities: EntityOption[];
  selectedIds: string[];
  canManage: boolean;
  hasAssistant: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set(selectedIds));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const conversationRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function toggleEntity(id: string, next: boolean) {
    const updated = new Set(selection);
    if (next) updated.add(id);
    else updated.delete(id);
    setSelection(updated);
    try {
      await updateDataAssistantEntitiesAction([...updated]);
    } catch {
      setSelection(selection);
      toast.error("Could not update the selection");
    }
  }

  async function send() {
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    setPending(true);
    setTurns((prev) => [
      ...prev,
      { role: "user", text: message },
      { role: "assistant", text: "", tools: [], pending: true },
    ]);

    const patchLast = (fn: (turn: AssistantTurn) => AssistantTurn) =>
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = fn(last);
        return next;
      });

    try {
      const res = await fetch("/api/data-assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationRef.current,
          message,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(await res.text());
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          switch (event.type) {
            case "turn":
              conversationRef.current = String(event.conversationId);
              break;
            case "tool-start":
              patchLast((t) => ({
                ...t,
                tools: [
                  ...t.tools,
                  {
                    callId: String(event.callId),
                    label: String(event.label ?? event.tool ?? "Tool"),
                  },
                ],
              }));
              break;
            case "tool-end":
              patchLast((t) => ({
                ...t,
                tools: t.tools.map((call) =>
                  call.callId === event.callId
                    ? {
                        ...call,
                        ok: Boolean(event.ok),
                        summary:
                          typeof event.summary === "string"
                            ? event.summary
                            : undefined,
                      }
                    : call
                ),
              }));
              break;
            case "text-delta":
              patchLast((t) => ({ ...t, text: t.text + String(event.delta) }));
              break;
            case "part": {
              const part = event.part as { type?: string; text?: string };
              // Streaming deltas already carried streamed text; parts cover
              // verbatim/non-streamed text answers.
              if (part?.type === "text" && part.text) {
                patchLast((t) =>
                  t.text ? t : { ...t, text: part.text ?? "" }
                );
              }
              break;
            }
            case "error":
              patchLast((t) => ({
                ...t,
                text: t.text || `Something went wrong: ${String(event.message)}`,
              }));
              break;
          }
        }
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch {
      patchLast((t) => ({
        ...t,
        text: t.text || "Something went wrong. Try again.",
      }));
    } finally {
      patchLast((t) => ({ ...t, pending: false }));
      setPending(false);
    }
  }

  const selectedCount = selection.size;

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8">
        {/* The button never shrinks, so on a phone the title and its blurb are
            what give — stack them instead of squeezing the heading into a
            one-word column. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <Database className="size-7" /> Data Assistant
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Ask questions over your organization&apos;s imported records —
              &quot;every delayed order, with totals&quot;. Answers show the
              queries they ran.
            </p>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit shrink-0"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings2 className="mr-1 size-4" />
              Data sources ({selectedCount})
            </Button>
          )}
        </div>

        {settingsOpen && canManage && (
          <Card className="mt-4 p-4">
            <p className="text-sm font-medium">
              Which data can the assistant query?
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              An org-level choice, separate from what customer-facing
              assistants see. Sensitive datasets stay out unless selected.
            </p>
            {entities.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">
                No Entities yet — define one under Settings → Data.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {entities.map((entity) => (
                  <Label
                    key={entity.id}
                    className="flex items-center gap-2 text-sm font-normal"
                  >
                    <Checkbox
                      checked={selection.has(entity.id)}
                      onCheckedChange={(v) => toggleEntity(entity.id, v === true)}
                    />
                    {entity.name}
                    {entity.scope === "user" && (
                      <Badge variant="outline">per-user data</Badge>
                    )}
                    {entity.description && (
                      <span className="text-muted-foreground truncate">
                        — {entity.description}
                      </span>
                    )}
                  </Label>
                ))}
              </div>
            )}
          </Card>
        )}

        <div ref={scrollRef} className="mt-6 flex-1 space-y-4 overflow-y-auto">
          {turns.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {hasAssistant
                ? selectedCount > 0
                  ? "Ask anything about the selected data."
                  : "Select at least one data source, then ask away."
                : "Create an assistant first — the data assistant uses your organization's model configuration."}
            </p>
          )}
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl px-4 py-2 text-sm">
                  {turn.text}
                </div>
              </div>
            ) : (
              <div key={i} className="max-w-[95%]">
                {turn.tools.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {turn.tools.map((call) => (
                      <span
                        key={call.callId}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                          call.ok === false
                            ? "text-destructive border-destructive/40"
                            : "text-muted-foreground"
                        }`}
                      >
                        <Wrench className="size-3" />
                        {call.label}
                        {call.summary ? ` — ${call.summary}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {turn.text ? (
                  <ChatMarkdown text={turn.text} className="text-sm" />
                ) : turn.pending ? (
                  <p className="text-muted-foreground text-sm">Thinking…</p>
                ) : null}
              </div>
            )
          )}
        </div>

        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Every delayed order, with totals…"
            disabled={!hasAssistant}
          />
          <Button type="submit" disabled={pending || !hasAssistant} aria-label="Send">
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
