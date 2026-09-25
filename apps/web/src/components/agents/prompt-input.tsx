"use client";
// beui.dev/components/agents/prompt-input

import { Plus } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { motion, useReducedMotion } from "motion/react";
import { VoiceBeam } from "voice-glow";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/motion/button";
import { VoiceInputButton, type VoiceEndpoint } from "@/components/chat/voice-input-button";
import { useRenderedTheme } from "@/components/chat/use-rendered-theme";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/components/motion/popover-morph";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/motion/select";
import { SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

// Stable Lucide icon data lets MorphIcon reshape one SVG path in place.
const ArrowUpData = [
  ["path", { d: "m5 12 7-7 7 7" }],
  ["path", { d: "M12 19V5" }],
] as const;
const StopData = [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
] as const;

export interface PromptModel {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptAction {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptInputProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "onChange" | "onSubmit" | "children"
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  models?: PromptModel[];
  model?: string;
  defaultModel?: string;
  onModelChange?: (model: string) => void;
  actions?: PromptAction[];
  onAction?: (action: string) => void;
  onSubmit?: (value: string, model?: string) => void | Promise<void>;
  loading?: boolean;
  onStop?: () => void;
  stopLabel?: string;
  /** Keep keyboard follow-ups available while the main button becomes Stop. */
  allowSubmitWhileLoading?: boolean;
  minRows?: number;
  maxRows?: number;
  leadingAction?: ReactNode;
  /** Dictation records audio and appends a transcript to the editable draft. */
  voiceInput?: VoiceEndpoint;
  /**
   * The typed text, re-rendered as nodes, painted exactly under the textarea's
   * own glyphs. Use it to tint a run of characters, and only that.
   *
   * The layer shares one class list with the textarea (`TEXT_LAYER`) so the two
   * wrap identically, and the textarea's own text is hidden while it is on. The
   * hard rule: **the highlight must not change any glyph's advance.** A padded
   * chip or a different font size makes the two flows disagree, and then the
   * caret sits somewhere other than the character it is editing. Backgrounds,
   * colour and weight-free decoration are safe; boxes with padding are not.
   */
  highlight?: ReactNode;
  className?: string;
}

/**
 * The typography every text layer in this control shares: the textarea, the
 * hidden height-measurement mirror, and the optional `highlight` overlay. One
 * constant because three copies of it drifted once already, the mirror measured
 * at `text-sm` while the phone rendered `text-base`, so the box came up a line
 * short on the surface where the composer matters most.
 */
const TEXT_LAYER =
  "px-2 pt-1.5 text-base leading-6 whitespace-pre-wrap [overflow-wrap:break-word] md:text-sm";

export function PromptInput({
  value,
  defaultValue = "",
  onValueChange,
  models = [],
  model,
  defaultModel,
  onModelChange,
  actions = [],
  onAction,
  onSubmit,
  loading = false,
  onStop,
  stopLabel = "Stop generating",
  allowSubmitWhileLoading = false,
  minRows = 2,
  maxRows = 8,
  leadingAction,
  voiceInput,
  highlight,
  className,
  disabled,
  placeholder = "Ask the agent to do something…",
  "aria-label": ariaLabel = "Prompt",
  onKeyDown,
  ...textareaProps
}: PromptInputProps) {
  const reduce = useReducedMotion() ?? false;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalModel, setInternalModel] = useState(
    defaultModel ?? models[0]?.value,
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null);
  const renderedTheme = useRenderedTheme();
  const currentValue = value ?? internalValue;
  const currentModelValue = model ?? internalModel;
  const currentModel = models.find(
    (option) => option.value === currentModelValue,
  );
  const inputBusy = loading && !allowSubmitWhileLoading;
  const canSubmit = Boolean(currentValue.trim()) && !disabled && !inputBusy && !voiceBusy;

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    const measurement = measurementRef.current;
    if (!textarea || !measurement || textarea.value !== currentValue) return;

    const lineHeight = 24;
    const nextHeight = Math.min(
      Math.max(measurement.scrollHeight, minRows * lineHeight),
      maxRows * lineHeight,
    );
    const height = `${nextHeight}px`;
    if (textarea.style.height !== height) textarea.style.height = height;
  }, [currentValue, maxRows, minRows]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeTextarea);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  /**
   * Keep the highlight layer's scroll offset on the textarea's. Without it, a
   * message long enough to scroll leaves the tinted names behind at the top
   * while the words move.
   */
  const syncHighlightScroll = useCallback(() => {
    const layer = highlightRef.current;
    const textarea = textareaRef.current;
    if (!layer || !textarea) return;
    layer.scrollTop = textarea.scrollTop;
  }, []);

  // An edit can move the scroll offset without firing `scroll` (typing at the
  // bottom of a full box), so the layer is re-synced whenever the value does.
  useLayoutEffect(syncHighlightScroll, [currentValue, syncHighlightScroll]);

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const setModel = (next: string) => {
    if (model === undefined) setInternalModel(next);
    onModelChange?.(next);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = currentValue.trim();
    if (!canSubmit) return;

    onSubmit?.(prompt, currentModelValue);
    if (value === undefined) setInternalValue("");
    textareaRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    submit();
  };

  const form = (
    <form
      onSubmit={submit}
      className={cn(
        "relative w-full rounded-2xl border border-border/80 bg-background p-2 transition-colors focus-within:border-foreground/25",
        disabled && "opacity-60",
        className,
      )}
    >
      <div
        ref={measurementRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none invisible absolute inset-x-2 top-0",
          TEXT_LAYER,
        )}
      >
        {`${currentValue}\u200b`}
      </div>
      <div className="relative">
        {highlight ? (
          <div
            ref={highlightRef}
            aria-hidden="true"
            // Same box as the textarea, minus the scrollbar: it scrolls in step
            // with it (see the effect below) rather than showing its own. This
            // layer paints every glyph, which is why it carries the text colour
            // and the textarea gives its own up.
            className={cn(
              "pointer-events-none absolute inset-0 overflow-hidden text-foreground",
              TEXT_LAYER,
            )}
          >
            {highlight}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={currentValue}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={minRows}
          {...textareaProps}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncHighlightScroll}
          // 16px below `md`: iOS Safari zooms the page in when a focused field
          // is smaller than that, and never zooms back out, on the chat
          // composer, the one control every mobile visitor touches.
          className={cn(
            "scrollbar-hide relative block w-full resize-none overflow-y-auto bg-transparent outline-none placeholder:text-muted-foreground/55",
            TEXT_LAYER,
            // With a highlight layer under it the glyphs come from there, and
            // this element contributes only the caret and the selection. The
            // caret is coloured explicitly because `text-transparent` would
            // otherwise take it with it.
            highlight
              ? "text-transparent caret-foreground selection:bg-primary/30 selection:text-transparent"
              : "text-foreground",
          )}
        />
      </div>

      <div className="mt-1 flex min-h-8 items-center gap-1">
        {actions.length ? (
          <MorphPopover open={actionsOpen} onOpenChange={setActionsOpen}>
            <MorphPopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || inputBusy}
                aria-label="Add to prompt"
                className="size-8 rounded-full"
              >
                <motion.span
                  aria-hidden="true"
                  animate={{ rotate: actionsOpen ? 45 : 0 }}
                  transition={reduce ? { duration: 0 } : SPRING_SWAP}
                >
                  <Plus className="size-4" />
                </motion.span>
              </Button>
            </MorphPopoverTrigger>

            <MorphPopoverContent
              side="top"
              align="start"
              sideOffset={8}
              radius={12}
              className="w-56 p-1.5"
            >
              {actions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    onAction?.(action.value);
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  {action.icon ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {action.label}
                    </span>
                    {action.description ? (
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </MorphPopoverContent>
          </MorphPopover>
        ) : null}
        {leadingAction}
        {models.length ? (
          <Select
            value={currentModelValue}
            onValueChange={setModel}
            disabled={disabled || inputBusy}
            className="min-w-0"
          >
            <SelectTrigger className="h-8 w-auto max-w-52 rounded-xl border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted focus-visible:ring-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {currentModel?.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">
                    {currentModel.icon}
                  </span>
                ) : null}
                <span className="truncate text-muted-foreground">
                  {currentModel?.label ?? "Choose model"}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent className="right-auto w-52 shadow-none">
              {models.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon ? (
                      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {option.label}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
        {voiceInput ? (
          <VoiceInputButton
            {...voiceInput}
            disabled={disabled || inputBusy}
            onBusyChange={setVoiceBusy}
            onStreamChange={setVoiceStream}
            onTranscript={(text) => {
              setValue(`${currentValue}${currentValue && !/\s$/.test(currentValue) ? " " : ""}${text}`);
              textareaRef.current?.focus({ preventScroll: true });
            }}
          />
        ) : null}
        <Button
          type={loading ? "button" : "submit"}
          size="icon"
          disabled={loading ? !onStop : !canSubmit}
          aria-label={loading ? stopLabel : "Send prompt"}
          title={loading ? stopLabel : undefined}
          onClick={loading ? onStop : undefined}
          className="size-8 rounded-full"
        >
          <MorphIcon
            icon={loading ? StopData : ArrowUpData}
            size={16}
            fill={loading ? "currentColor" : "none"}
          />
        </Button>
        </div>
      </div>
    </form>
  );

  return voiceInput ? (
    <VoiceBeam stream={voiceStream} active={voiceStream !== null} theme={renderedTheme} className="w-full">
      {form}
    </VoiceBeam>
  ) : form;
}
