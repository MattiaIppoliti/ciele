"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  Assistant,
  KnowledgeEngine,
  Provider,
  QuickReplyButton,
  QuickReplyType,
} from "@agent-hub/db";
import { shortId } from "@agent-hub/db";
import { MODEL_CATALOG, PROVIDER_NAMES } from "@/lib/runtime/client";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { updateAssistantAction, uploadAssistantAvatarAction } from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DESCRIPTION_MAX = 500;
const AI_DISCLAIMER_MAX = 1000;
const ANSWERING_STYLE_MAX = 10000;
const QUICK_REPLY_MAX = 50;

const QUICK_REPLY_TYPES: Array<{ value: QuickReplyType; label: string }> = [
  { value: "send_text", label: "Send Text Into Chat" },
  { value: "escalation", label: "Escalation" },
  { value: "external_link", label: "Open External Link" },
  { value: "faq", label: "FAQ" },
];

function quickReplyTypeLabel(type: QuickReplyType): string {
  return QUICK_REPLY_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** Markdown toolbar command: wrap the selection, or prefix the current line. */
type ToolbarCommand = { wrap: string; wrapEnd?: string } | { prefix: string };

/**
 * Static toolbar spec — kept out of render so the mapped array never captures
 * the textarea ref (the ref is only read inside the click handler).
 */
const TOOLBAR_BUTTONS: Array<{
  label: string;
  Icon: typeof Bold;
  command: ToolbarCommand;
}> = [
  { label: "Bold", Icon: Bold, command: { wrap: "**" } },
  { label: "Italic", Icon: Italic, command: { wrap: "*" } },
  { label: "Heading 1", Icon: Heading1, command: { prefix: "# " } },
  { label: "Heading 2", Icon: Heading2, command: { prefix: "## " } },
  { label: "Heading 3", Icon: Heading3, command: { prefix: "### " } },
  { label: "Heading 4", Icon: Heading4, command: { prefix: "#### " } },
  { label: "Bullet list", Icon: List, command: { prefix: "- " } },
  { label: "Numbered list", Icon: ListOrdered, command: { prefix: "1. " } },
  { label: "Divider", Icon: Minus, command: { prefix: "\n---\n" } },
  { label: "Link", Icon: Link2, command: { wrap: "[", wrapEnd: "](url)" } },
];

function FieldHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>
    </div>
  );
}

export function GeneralForm({ assistant }: { assistant: Assistant }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [launcherEnabled, setLauncherEnabled] = useState(
    assistant.chatLauncherEnabled
  );
  const [title, setTitle] = useState(assistant.title);
  const [nickname, setNickname] = useState(assistant.nickname);
  const [avatarUrl, setAvatarUrl] = useState(assistant.avatarUrl ?? "");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [description, setDescription] = useState(assistant.description);
  const [welcomeMessage, setWelcomeMessage] = useState(
    assistant.welcomeMessage
  );
  const [aiDisclaimer, setAiDisclaimer] = useState(assistant.aiDisclaimer);
  const [questions, setQuestions] = useState<string[]>(
    assistant.suggestedQuestions
  );
  const [quickReplies, setQuickReplies] = useState<QuickReplyButton[]>(
    assistant.quickReplies ?? []
  );
  const [answeringStyle, setAnsweringStyle] = useState(
    assistant.answeringStyle
  );
  const [modelProvider, setModelProvider] = useState<Provider>(
    assistant.modelProvider
  );
  const [modelId, setModelId] = useState(assistant.modelId);
  const [knowledgeEngine, setKnowledgeEngine] = useState<KnowledgeEngine>(
    assistant.knowledgeEngine ?? "graph"
  );
  const welcomeRef = useRef<HTMLTextAreaElement>(null);

  const dirty =
    launcherEnabled !== assistant.chatLauncherEnabled ||
    title !== assistant.title ||
    nickname !== assistant.nickname ||
    description !== assistant.description ||
    welcomeMessage !== assistant.welcomeMessage ||
    aiDisclaimer !== assistant.aiDisclaimer ||
    answeringStyle !== assistant.answeringStyle ||
    modelProvider !== assistant.modelProvider ||
    modelId !== assistant.modelId ||
    knowledgeEngine !== (assistant.knowledgeEngine ?? "graph") ||
    JSON.stringify(questions) !== JSON.stringify(assistant.suggestedQuestions) ||
    JSON.stringify(quickReplies) !==
      JSON.stringify(assistant.quickReplies ?? []);

  function wrapSelection(before: string, after = before) {
    const el = welcomeRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    const next =
      value.slice(0, selectionStart) +
      before +
      selected +
      after +
      value.slice(selectionEnd);
    setWelcomeMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(
        selectionStart + before.length,
        selectionEnd + before.length
      );
    });
  }

  function prefixLine(prefix: string) {
    const el = welcomeRef.current;
    if (!el) return;
    const { selectionStart, value } = el;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    setWelcomeMessage(next);
    requestAnimationFrame(() => el.focus());
  }

  function handleSave() {
    if (!title.trim()) {
      toast.error("Assistant title is required");
      return;
    }
    startTransition(async () => {
      await updateAssistantAction(assistant.id, {
        chatLauncherEnabled: launcherEnabled,
        title: title.trim(),
        nickname: nickname.trim(),
        description,
        welcomeMessage,
        aiDisclaimer,
        suggestedQuestions: questions.map((q) => q.trim()).filter(Boolean),
        quickReplies: quickReplies
          .map((b) => ({ ...b, label: b.label.trim() }))
          .filter((b) => b.label),
        answeringStyle,
        modelProvider,
        modelId,
        knowledgeEngine,
      });
      toast.success("Settings saved");
      router.refresh();
    });
  }

  async function uploadAvatar(file: File) {
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(previewUrl);
    const form = new FormData();
    form.set("file", file);
    const result = await uploadAssistantAvatarAction(assistant.id, form);
    URL.revokeObjectURL(previewUrl);
    setAvatarPreviewUrl("");
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.avatarUrl) {
      setAvatarUrl(result.avatarUrl);
      toast.success("Avatar uploaded");
      router.refresh();
    }
  }

  function applyCommand(command: ToolbarCommand) {
    if ("wrap" in command) wrapSelection(command.wrap, command.wrapEnd ?? command.wrap);
    else prefixLine(command.prefix);
  }

  return (
    <div className="space-y-8 pt-8 pb-24">
      {/* Chat launcher */}
      <Card size="sm" className="gap-0 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Enable chat launcher</h2>
            <p className="text-muted-foreground mt-1 max-w-xl text-sm">
              When enabled, shows the chat button. If AI Feedback is also
              enabled, feedback can be accessed from within the chat window on
              grading pages. When disabled, feedback (if enabled) appears as a
              standalone launcher.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge
              variant="outline"
              className={
                launcherEnabled
                  ? "gap-1.5 rounded-full bg-muted/50 text-foreground"
                  : "gap-1.5 rounded-full"
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  launcherEnabled ? "bg-foreground" : "bg-muted-foreground/50"
                }`}
              />
              {launcherEnabled ? "Active" : "Inactive"}
            </Badge>
            <Switch
              checked={launcherEnabled}
              onCheckedChange={setLauncherEnabled}
              aria-label="Enable chat launcher"
            />
          </div>
        </div>
      </Card>

      {/* Model */}
      <div className="space-y-3">
        <FieldHeader
          title="Model"
          hint="Provider and model for published widget traffic (requires an organization credential in Settings → AI). Preview conversations use your connected local subscription and its default model from Settings → AI → Chat settings instead."
        />
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" className="h-11 w-40 justify-start" />}
            >
              {PROVIDER_NAMES[modelProvider]}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {/* Providers without a static catalog (openai_compatible) are
                  not offered per-assistant: the runtime reaches them through
                  cross-provider fallback with the connection's chat model. */}
              {(Object.keys(PROVIDER_NAMES) as Provider[])
                .filter((p) => MODEL_CATALOG[p].length > 0)
                .map((p) => (
                  <DropdownMenuItem
                    key={p}
                    onClick={() => {
                      setModelProvider(p);
                      setModelId(MODEL_CATALOG[p][0].id);
                    }}
                  >
                    {PROVIDER_NAMES[p]}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" className="h-11 flex-1 justify-start" />}
            >
              {MODEL_CATALOG[modelProvider].find((m) => m.id === modelId)?.label ?? modelId}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              {MODEL_CATALOG[modelProvider].map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => setModelId(m.id)}>
                  {m.label}
                  <span className="text-muted-foreground ml-auto font-mono text-xs">{m.id}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Knowledge Engine */}
      <div className="space-y-3">
        <FieldHeader
          title="Knowledge engine"
          hint="How knowledge searches are answered. Graph (primary) retrieves from the connected knowledge graph and learns from feedback; it falls back to Vector automatically when the graph service is unavailable. Vector uses classic embedding search only. Graph makes richer, connected answers at a higher per-answer cost. Either way, answers stay cited to their source."
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="outline" className="h-11 w-56 justify-start" />}
          >
            {knowledgeEngine === "graph" ? "Graph (primary)" : "Vector"}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setKnowledgeEngine("graph")}>
              Graph (primary)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setKnowledgeEngine("vector")}>
              Vector
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Logo */}
      <div className="space-y-3">
        <FieldHeader
          title="Assistant logo"
          hint="Circular icon shown next to this assistant in the sidebar and widget header."
        />
        <AvatarUpload
          value={avatarPreviewUrl || avatarUrl}
          onFile={(file) =>
            startTransition(() => {
              void uploadAvatar(file);
            })
          }
          fallback={
            <span className="bg-primary text-primary-foreground flex size-full items-center justify-center text-2xl font-semibold">
              {title.slice(0, 1).toUpperCase() || "?"}
            </span>
          }
        />
      </div>

      {/* Title */}
      <div className="space-y-3">
        <FieldHeader
          title="Assistant title"
          hint="This will be how you see it on your assistants page."
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </div>

      {/* Nickname */}
      <div className="space-y-3">
        <FieldHeader
          title="Nickname"
          hint="Displayed on the AI Assistant header."
        />
        <Input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="h-11"
        />
      </div>

      {/* Description */}
      <div className="space-y-3">
        <FieldHeader
          title="Description"
          hint="A short overview of what this assistant does"
        />
        <div>
          <Textarea
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="resize-none"
          />
          <p className="text-muted-foreground mt-1 text-right text-xs">
            {description.length}/{DESCRIPTION_MAX}
          </p>
        </div>
      </div>

      {/* Welcome message */}
      <div className="space-y-3">
        <FieldHeader
          title="Welcome Message"
          hint="Shown when users first open the assistant"
        />
        <div className="rounded-xl border">
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            {TOOLBAR_BUTTONS.map((btn) => (
              <Hint key={btn.label} label={btn.label}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={btn.label}
                  className="size-8"
                  onClick={() => applyCommand(btn.command)}
                >
                  <btn.Icon className="size-4" />
                </Button>
              </Hint>
            ))}
          </div>
          <Textarea
            ref={welcomeRef}
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={5}
            className="resize-none rounded-t-none border-0 shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* AI Disclaimer */}
      <div className="space-y-3">
        <FieldHeader
          title="AI Disclaimer"
          hint="Shown under AI responses at the bottom of the chat window. Leave empty to hide it."
        />
        <div>
          <Textarea
            value={aiDisclaimer}
            maxLength={AI_DISCLAIMER_MAX}
            onChange={(e) => setAiDisclaimer(e.target.value)}
            rows={3}
            placeholder="AI answers are not perfect, so please double-check any critical information."
            className="resize-none"
          />
          <p className="text-muted-foreground mt-1 text-right text-xs">
            {aiDisclaimer.length}/{AI_DISCLAIMER_MAX}
          </p>
        </div>
      </div>

      {/* Answering style (the assistant's system prompt) */}
      <div className="space-y-3">
        <FieldHeader
          title="Answering style"
          hint="System instructions for this assistant: persona, tone, format, and behavior. Applied on top of the platform rules — it cannot override them."
        />
        <div>
          <Textarea
            value={answeringStyle}
            maxLength={ANSWERING_STYLE_MAX}
            onChange={(e) => setAnsweringStyle(e.target.value)}
            rows={8}
            placeholder={
              "e.g. You are the virtual assistant for Acme Corp. Be warm and concise, use bullet points for procedures, and always end factual answers with the relevant team to contact..."
            }
            className="resize-y"
          />
          <p className="text-muted-foreground mt-1 text-right text-xs">
            {answeringStyle.length}/{ANSWERING_STYLE_MAX}
          </p>
        </div>
      </div>

      {/* Suggested questions */}
      <div className="space-y-3">
        <FieldHeader
          title="Suggested questions"
          hint="Quick prompts shown under the welcome message"
        />
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={q}
                onChange={(e) =>
                  setQuestions(
                    questions.map((cur, j) => (j === i ? e.target.value : cur))
                  )
                }
                placeholder="e.g. When is my next assignment due?"
              />
              <Hint label="Remove question">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove question"
                  onClick={() =>
                    setQuestions(questions.filter((_, j) => j !== i))
                  }
                >
                  <X className="size-4" />
                </Button>
              </Hint>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setQuestions([...questions, ""])}
          >
            <Plus className="size-4" /> Add question
          </Button>
        </div>
      </div>

      {/* Quick reply buttons */}
      <div className="space-y-3">
        <FieldHeader
          title="Quick reply buttons"
          hint="Typed starter buttons shown above the suggested questions — pre-fill a message, escalate to support, or open a link."
        />
        <div className="space-y-2">
          {quickReplies.map((button, i) => {
            const patchButton = (patch: Partial<QuickReplyButton>) =>
              setQuickReplies(
                quickReplies.map((cur, j) =>
                  j === i ? { ...cur, ...patch } : cur
                )
              );
            const move = (dir: -1 | 1) => {
              const j = i + dir;
              if (j < 0 || j >= quickReplies.length) return;
              const next = [...quickReplies];
              [next[i], next[j]] = [next[j], next[i]];
              setQuickReplies(next);
            };
            return (
              <div key={button.id} className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <Hint label="Move up" side="left">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => move(-1)}
                        className="text-muted-foreground rounded px-1 leading-none hover:bg-muted disabled:opacity-30"
                      >
                        ▴
                      </button>
                    </Hint>
                    <Hint label="Move down" side="left">
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === quickReplies.length - 1}
                        onClick={() => move(1)}
                        className="text-muted-foreground rounded px-1 leading-none hover:bg-muted disabled:opacity-30"
                      >
                        ▾
                      </button>
                    </Hint>
                  </div>
                  <Input
                    value={button.label}
                    onChange={(e) => patchButton({ label: e.target.value })}
                    placeholder="Button name"
                    className="flex-1"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="w-48 justify-start"
                        />
                      }
                    >
                      {quickReplyTypeLabel(button.type)}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {QUICK_REPLY_TYPES.map((t) => (
                        <DropdownMenuItem
                          key={t.value}
                          onClick={() => patchButton({ type: t.value })}
                        >
                          {t.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Hint label="Remove button">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove button"
                      onClick={() =>
                        setQuickReplies(quickReplies.filter((_, j) => j !== i))
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </Hint>
                </div>
                {(button.type === "send_text" || button.type === "faq") && (
                  <Input
                    value={button.text ?? ""}
                    onChange={(e) => patchButton({ text: e.target.value })}
                    placeholder={
                      button.type === "faq"
                        ? "FAQ question to answer"
                        : "Message sent into the chat"
                    }
                  />
                )}
                {button.type === "external_link" && (
                  <Input
                    value={button.url ?? ""}
                    onChange={(e) => patchButton({ url: e.target.value })}
                    placeholder="https://example.edu/page"
                  />
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={quickReplies.length >= QUICK_REPLY_MAX}
            onClick={() =>
              setQuickReplies([
                ...quickReplies,
                { id: shortId(), label: "", type: "send_text" },
              ])
            }
          >
            <Plus className="size-4" /> Add button ({quickReplies.length}/
            {QUICK_REPLY_MAX})
          </Button>
        </div>
      </div>

      {/* Save bar */}
      <div className="bg-background/95 sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t px-2 py-4 backdrop-blur">
        {dirty && (
          <span className="text-muted-foreground text-sm">
            Unsaved changes
          </span>
        )}
        <Button
          onClick={handleSave}
          disabled={isPending || !dirty}
          className="px-6 font-semibold"
        >
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
