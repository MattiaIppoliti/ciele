"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import type {
  Assistant,
  ModelRef,
  Provider,
  QuickReplyButton,
  QuickReplyType,
} from "@agent-hub/core";
import { shortId } from "@agent-hub/core";

import { MODEL_CATALOG, PROVIDER_NAMES, currentModelId } from "@agent-hub/agent/client";
import {
  ModelAllowList,
  modelAllowListSummary,
} from "@/components/chat/model-allow-list";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import {
  SectionTimeline,
  TimelineSection,
} from "@/components/settings/section-timeline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bold, GripVertical, Heading1, Heading2, Heading3, Heading4, Italic, Plus, X } from "lucide-react";
import { Link2, List, ListOrdered, Minus } from "lucide-react";
import { moveOrderedId, reorderItemsByIds } from "@/lib/list-order";
import { toast } from "@/lib/toast";
import { applyMarkdownCommand, type MarkdownCommand } from "@/lib/markdown-toolbar";
import { updateAssistantAction, uploadAssistantAvatarAction } from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Switch } from "@/components/ui/motion-switch";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { formatCount } from "@/lib/format";
import {
  SortableHandle,
  SortableItem,
  SortableList,
} from "@/components/ui/sortable-list";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

import { VoiceSettings, EMPTY_VOICE_SETTINGS } from "./voice-settings";

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

/** The on/off pill beside a section's switch. */
function StatePill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={on ? "gap-1.5 rounded-full bg-muted/50 text-foreground" : "gap-1.5 rounded-full"}
    >
      <span
        className={`size-1.5 rounded-full ${on ? "bg-foreground" : "bg-muted-foreground/50"}`}
      />
      {children}
    </Badge>
  );
}

/**
 * Static toolbar spec: kept out of render so the mapped array never captures
 * the textarea ref (the ref is only read inside the click handler).
 */
const TOOLBAR_BUTTONS: Array<{
  label: string;
  Icon: typeof Bold;
  command: MarkdownCommand;
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

/**
 * A field's heading and hint. With `htmlFor`, the heading text is the
 * control's `<label>` and the hint is reachable as `${htmlFor}-hint`, so pass
 * that to the control's `aria-describedby`.
 */
/** `n/max` under a field: only the changing half rolls. */
function CharCount({ value, max }: { value: number; max: number }) {
  return (
    <p className="text-muted-foreground mt-1 text-right text-xs tabular-nums">
      <RollingNumber value={value} />/{formatCount(max)}
    </p>
  );
}

function FieldHeader({
  title,
  hint,
  htmlFor,
}: {
  title: string;
  hint: string;
  htmlFor?: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold">
        {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}
      </h2>
      <p
        id={htmlFor ? `${htmlFor}-hint` : undefined}
        className="text-muted-foreground mt-0.5 text-sm"
      >
        {hint}
      </p>
    </div>
  );
}

export function GeneralForm({
  assistant,
  unavailableProviders,
}: {
  assistant: Assistant;
  /** Providers this Organization has no credential for; the picker skips them. */
  unavailableProviders: Provider[];
}) {
  const [isPending, startTransition] = useTransition();
  // Its own transition, so an avatar upload never reads as "Saving…".
  const [isUploading, startUpload] = useTransition();
  const fieldId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [titleError, setTitleError] = useState("");

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
  const [simplifiedThinking, setSimplifiedThinking] = useState(
    assistant.simplifiedThinking
  );
  const [modelProvider, setModelProvider] = useState<Provider>(
    assistant.modelProvider
  );
  // A retired model (Haiku 4.5, gpt-5.1-mini) opens on the model that now
  // answers in its place, which is also what the runtime already runs.
  const [modelId, setModelId] = useState(() =>
    currentModelId(assistant.modelProvider, assistant.modelId)
  );
  const [allowedModels, setAllowedModels] = useState<ModelRef[]>(
    assistant.allowedModels ?? []
  );
  const [voice, setVoice] = useState(assistant.voice ?? EMPTY_VOICE_SETTINGS);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(
    assistant.attachmentsEnabled ?? false
  );
  const welcomeRef = useRef<HTMLTextAreaElement>(null);
  // The shared sortable primitive makes the complete quick-reply card follow
  // the pointer and swaps it only after it crosses a neighbouring card.
  const [draggedReplyId, setDraggedReplyId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");

  const voiceDirty =
    JSON.stringify(voice) !== JSON.stringify(assistant.voice ?? EMPTY_VOICE_SETTINGS);
  // A configured model that moved is implicitly in the picker, so drop any
  // duplicate of it rather than storing the same model twice.
  const extraModels = allowedModels.filter(
    (ref) => !(ref.provider === modelProvider && ref.modelId === modelId)
  );
  const dirty =
    voiceDirty ||
    launcherEnabled !== assistant.chatLauncherEnabled ||
    title !== assistant.title ||
    nickname !== assistant.nickname ||
    description !== assistant.description ||
    welcomeMessage !== assistant.welcomeMessage ||
    aiDisclaimer !== assistant.aiDisclaimer ||
    answeringStyle !== assistant.answeringStyle ||
    simplifiedThinking !== assistant.simplifiedThinking ||
    modelProvider !== assistant.modelProvider ||
    // Compared against the resolved id the state opened on, or a retired
    // model would load the form already dirty.
    modelId !== currentModelId(assistant.modelProvider, assistant.modelId) ||
    JSON.stringify(allowedModels) !==
      JSON.stringify(assistant.allowedModels ?? []) ||
    attachmentsEnabled !== (assistant.attachmentsEnabled ?? false) ||
    JSON.stringify(questions) !== JSON.stringify(assistant.suggestedQuestions) ||
    JSON.stringify(quickReplies) !==
      JSON.stringify(assistant.quickReplies ?? []);

  // A reload or closed tab would drop every unsaved field without a word; the
  // browser's own "Leave site?" prompt is the whole guard here, since the
  // editor's navigation is links this form does not own.
  useUnsavedChanges({ dirty });

  function handleSave() {
    if (!title.trim()) {
      setTitleError("Enter a title for this assistant.");
      titleRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
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
        simplifiedThinking,
        modelProvider,
        modelId,
        allowedModels: extraModels,
        attachmentsEnabled,
        ...(voiceDirty ? { voice } : {}),
      });
      toast.success("Settings saved");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save settings");
      }
    });
  }

  async function uploadAvatar(file: File) {
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(previewUrl);
    const form = new FormData();
    form.set("file", file);
    try {
      const result = await uploadAssistantAvatarAction(assistant.id, form);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.avatarUrl) {
        setAvatarUrl(result.avatarUrl);
        toast.success("Avatar uploaded");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the avatar");
    } finally {
      // A failed upload must not leave the local preview posing as the logo.
      URL.revokeObjectURL(previewUrl);
      setAvatarPreviewUrl("");
    }
  }

  function applyCommand(command: MarkdownCommand) {
    const el = welcomeRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    setWelcomeMessage(applyMarkdownCommand(value, selectionStart, selectionEnd, command));
    requestAnimationFrame(() => {
      el.focus();
      // A wrap keeps the original selection selected, inside its new markers.
      if ("wrap" in command) {
        el.setSelectionRange(
          selectionStart + command.wrap.length,
          selectionEnd + command.wrap.length
        );
      }
    });
  }

  return (
    <div className="pt-10 pb-24">
      <SectionTimeline>
      <TimelineSection title="Chat launcher">
      {/* Chat launcher */}
      <Card size="sm" className="gap-0 p-4">
        {/* The switch group never shrinks, so on a narrow screen the copy is
            what gives, stack them instead of squeezing the paragraph into a
            one-word column. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Enable chat launcher</h2>
            <p className="text-muted-foreground mt-1 max-w-xl text-sm">
              Shows the chat button on your pages.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatePill on={launcherEnabled}>
              <RollInText text={launcherEnabled ? "Active" : "Inactive"} />
            </StatePill>
            <Switch
              checked={launcherEnabled}
              onCheckedChange={setLauncherEnabled}
              aria-label="Enable chat launcher"
            />
          </div>
        </div>
      </Card>
      </TimelineSection>

      <TimelineSection title="Model & knowledge" boxed>
      <div className="space-y-8">
      {/* Model */}
      <div className="space-y-3">
        <FieldHeader
          title="Model"
          hint="Answers published chats. Needs an organization credential in Settings → AI. The Preview uses your own default model."
        />
        <div className="flex gap-2">
          <Select value={modelProvider} onValueChange={(provider) => {
            const next = provider as Provider;
            setModelProvider(next);
            setModelId(MODEL_CATALOG[next][0].id);
          }} className="w-40">
            <SelectTrigger className="h-11" aria-label="Model provider">
              <SelectValue>{PROVIDER_NAMES[modelProvider]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {/* Providers without a static catalog (openai_compatible) are
                  not offered per-assistant: the runtime reaches them through
                  cross-provider fallback with the connection's chat model. */}
              {(Object.keys(PROVIDER_NAMES) as Provider[])
                .filter((p) => MODEL_CATALOG[p].length > 0)
                .map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_NAMES[p]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={modelId} onValueChange={setModelId} className="min-w-0 flex-1">
            <SelectTrigger className="h-11" aria-label="Model">
              <SelectValue>{MODEL_CATALOG[modelProvider].find((m) => m.id === modelId)?.label ?? modelId}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MODEL_CATALOG[modelProvider].map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  <span className="text-muted-foreground ml-auto font-mono text-xs">{m.id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Models the chat window offers */}
      <div className="space-y-3">
        <FieldHeader
          title="Let visitors choose the model"
          hint="Extra models visitors can switch to. Leave empty to hide the picker."
        />
        <ModelAllowList
          configured={{ provider: modelProvider, modelId }}
          value={allowedModels}
          onChange={setAllowedModels}
          unavailable={unavailableProviders}
        />
        <p className="text-muted-foreground text-xs">
          {modelAllowListSummary(extraModels, unavailableProviders)}
        </p>
      </div>

      {/* Visitor attachments */}
      <div className="space-y-3">
        <FieldHeader
          title="Let visitors attach files"
          hint="Visitors can attach a PDF, Office file, text file or image. Files are read once and never stored."
        />
        <div className="flex items-center gap-3">
          <Switch
            checked={attachmentsEnabled}
            onCheckedChange={setAttachmentsEnabled}
            aria-label="Let visitors attach files"
          />
          <span className="text-muted-foreground text-sm">
            {attachmentsEnabled
              ? "Visitors can attach files."
              : "Visitors cannot attach files."}
          </span>
        </div>
      </div>
      </div>
      </TimelineSection>

      <TimelineSection title="Voice mode">
        <VoiceSettings assistantId={assistant.id} value={voice} onChange={setVoice} />
      </TimelineSection>

      <TimelineSection title="Identity" boxed>
      <div className="space-y-8">
      {/* Logo */}
      <div className="space-y-3">
        <FieldHeader
          title="Assistant logo"
          hint="Circular icon shown next to this assistant in the sidebar and widget header."
        />
        <AvatarUpload
          value={avatarPreviewUrl || avatarUrl}
          onFile={(file) =>
            startUpload(async () => {
              await uploadAvatar(file);
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
          htmlFor={`${fieldId}-title`}
          hint="Shown on your assistants page."
        />
        <Input
          ref={titleRef}
          id={`${fieldId}-title`}
          aria-describedby={
            titleError
              ? `${fieldId}-title-hint ${fieldId}-title-error`
              : `${fieldId}-title-hint`
          }
          aria-invalid={titleError ? true : undefined}
          name="title"
          autoComplete="off"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError && e.target.value.trim()) setTitleError("");
          }}
          className="h-11"
        />
        {titleError && (
          <p id={`${fieldId}-title-error`} className="text-destructive text-sm">
            {titleError}
          </p>
        )}
      </div>

      {/* Nickname */}
      <div className="space-y-3">
        <FieldHeader
          title="Nickname"
          htmlFor={`${fieldId}-nickname`}
          hint="Displayed on the AI Assistant header."
        />
        <Input
          id={`${fieldId}-nickname`}
          aria-describedby={`${fieldId}-nickname-hint`}
          name="nickname"
          autoComplete="off"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="h-11"
        />
      </div>

      {/* Description */}
      <div className="space-y-3">
        <FieldHeader
          title="Description"
          htmlFor={`${fieldId}-description`}
          hint="A short overview of what this assistant does"
        />
        <div>
          <Textarea
            id={`${fieldId}-description`}
            aria-describedby={`${fieldId}-description-hint`}
            name="description"
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="resize-none"
          />
          <CharCount value={description.length} max={DESCRIPTION_MAX} />
        </div>
      </div>
      </div>
      </TimelineSection>

      <TimelineSection title="Messaging" boxed>
      <div className="space-y-8">
      {/* Welcome message */}
      <div className="space-y-3">
        <FieldHeader
          title="Welcome Message"
          htmlFor={`${fieldId}-welcome`}
          hint="Shown when users first open the assistant"
        />
        <div className="focus-within:border-ring focus-within:ring-ring/50 rounded-xl border transition-[border-color,box-shadow] focus-within:ring-3">
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
            id={`${fieldId}-welcome`}
            aria-describedby={`${fieldId}-welcome-hint`}
            name="welcomeMessage"
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
          htmlFor={`${fieldId}-disclaimer`}
          hint="Shown under AI responses at the bottom of the chat window. Leave empty to hide it."
        />
        <div>
          <Textarea
            id={`${fieldId}-disclaimer`}
            aria-describedby={`${fieldId}-disclaimer-hint`}
            name="aiDisclaimer"
            value={aiDisclaimer}
            maxLength={AI_DISCLAIMER_MAX}
            onChange={(e) => setAiDisclaimer(e.target.value)}
            rows={3}
            placeholder="AI answers are not perfect, so please double-check any critical information."
            className="resize-none"
          />
          <CharCount value={aiDisclaimer.length} max={AI_DISCLAIMER_MAX} />
        </div>
      </div>
      </div>
      </TimelineSection>

      <TimelineSection title="Behavior" boxed>
      <div className="space-y-8">
      {/* Answering style (the assistant's system prompt) */}
      <div className="space-y-3">
        <FieldHeader
          title="Answering style"
          htmlFor={`${fieldId}-style`}
          hint="Persona, tone and format. Platform rules still apply."
        />
        <div>
          <Textarea
            id={`${fieldId}-style`}
            aria-describedby={`${fieldId}-style-hint`}
            name="answeringStyle"
            value={answeringStyle}
            maxLength={ANSWERING_STYLE_MAX}
            onChange={(e) => setAnsweringStyle(e.target.value)}
            rows={8}
            placeholder={
              "e.g. You are the virtual assistant for Acme Corp. Be warm and concise, use bullet points for procedures, and always end factual answers with the relevant team to contact…"
            }
            className="resize-y"
          />
          <CharCount value={answeringStyle.length} max={ANSWERING_STYLE_MAX} />
        </div>
      </div>

      {/* Simplified thinking */}
      <Card size="sm" className="gap-0 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Simplified thinking</h2>
            <p className="text-muted-foreground mt-1 max-w-xl text-sm">
              Show visitors one short line per step while the assistant works, like &ldquo;Checking the return policy…&rdquo;. The Inbox keeps the lines too.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatePill on={simplifiedThinking}>
              <RollInText text={simplifiedThinking ? "On" : "Off"} />
            </StatePill>
            <Switch
              checked={simplifiedThinking}
              onCheckedChange={setSimplifiedThinking}
              aria-label="Simplified thinking"
            />
          </div>
        </div>
      </Card>
      </div>
      </TimelineSection>

      <TimelineSection title="Shortcuts" boxed>
      <div className="space-y-8">
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
                placeholder="e.g. How do I reset my password?"
                aria-label={`Suggested question ${i + 1}`}
                autoComplete="off"
              />
              <Hint label="Remove question">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove question ${i + 1}`}
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
          hint="Buttons above the suggested questions: send a message, contact support or open a link."
        />
        <SortableList
          values={quickReplies.map((button) => button.id)}
          onReorder={(ids) =>
            setQuickReplies((current) => reorderItemsByIds(current, ids))
          }
          className="space-y-2"
        >
          <p className="sr-only" aria-live="polite">{reorderAnnouncement}</p>
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
              const ids = moveOrderedId(
                quickReplies.map((reply) => reply.id),
                button.id,
                quickReplies[j]!.id
              );
              setQuickReplies(reorderItemsByIds(quickReplies, ids));
              setReorderAnnouncement(
                `${button.label || "Button"} moved to position ${j + 1} of ${quickReplies.length}`
              );
            };
            return (
              <SortableItem
                key={button.id}
                value={button.id}
                onDragStart={() => setDraggedReplyId(button.id)}
                onDragEnd={() => setDraggedReplyId(null)}
              >
                <div
                  className={`space-y-2 rounded-xl border p-3 transition-[background-color,box-shadow] ${
                    draggedReplyId === button.id
                      ? "bg-muted/50 ring-primary/50 ring-2"
                      : draggedReplyId
                        ? "ring-primary/20"
                        : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Hint label="Drag to reorder" side="left">
                      <SortableHandle
                        aria-label={`Drag ${button.label || "button"} to reorder it`}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            move(-1);
                          }
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            move(1);
                          }
                        }}
                        className="text-muted-foreground/60 hover:text-foreground focus-visible:ring-ring flex h-9 w-7 shrink-0 touch-none items-center justify-center rounded-md outline-none transition-colors select-none focus-visible:ring-2 data-[dragging=true]:cursor-grabbing md:cursor-grab"
                        data-dragging={draggedReplyId === button.id}
                      >
                        <GripVertical className="size-5" />
                      </SortableHandle>
                    </Hint>
                  <Input
                    value={button.label}
                    onChange={(e) => patchButton({ label: e.target.value })}
                    placeholder="Button name"
                    aria-label={`Quick reply ${i + 1} name`}
                    autoComplete="off"
                    className="flex-1"
                  />
                  <Select value={button.type} onValueChange={(type) => patchButton({ type: type as QuickReplyType })} className="w-48">
                    <SelectTrigger aria-label={`Quick reply ${i + 1} type`}>
                      <SelectValue>{quickReplyTypeLabel(button.type)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {QUICK_REPLY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Hint label="Remove button">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove button ${i + 1}`}
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
                    aria-label={
                      button.type === "faq"
                        ? `Quick reply ${i + 1} FAQ question`
                        : `Quick reply ${i + 1} message`
                    }
                    autoComplete="off"
                  />
                )}
                {button.type === "external_link" && (
                  <Input
                    value={button.url ?? ""}
                    onChange={(e) => patchButton({ url: e.target.value })}
                    placeholder="https://example.com/page"
                    aria-label={`Quick reply ${i + 1} link URL`}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
                </div>
              </SortableItem>
            );
          })}
        </SortableList>
        <div>
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
            <Plus className="size-4" /> Add button (
            <span className="tabular-nums">
              <RollingNumber value={quickReplies.length} />/{formatCount(QUICK_REPLY_MAX)}
            </span>
            )
          </Button>
        </div>
      </div>
      </div>
      </TimelineSection>
      </SectionTimeline>

      {/* Save bar */}
      <div className="bg-content/95 sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t px-2 py-4 backdrop-blur">
        {/* The live region stays mounted: one that appears together with its
            text is not reliably announced. */}
        <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
          {dirty ? "Unsaved changes" : ""}
        </span>
        <Button
          onClick={handleSave}
          disabled={isPending || isUploading || !dirty}
          className="px-6 font-semibold"
        >
          <RollInText text={isPending ? "Saving…" : "Save changes"} />
        </Button>
      </div>
    </div>
  );
}
