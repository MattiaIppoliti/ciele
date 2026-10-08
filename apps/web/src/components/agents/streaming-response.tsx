"use client";
// beui.dev/components/agents/streaming-response

import { Button as CieleButton } from "@agent-hub/ui";
import { ChevronDown } from "lucide-react";
import { Button } from "@agent-hub/ui";
// Icon data for the copy mark, which reshapes into the check on click.
import { Check as CheckData, Copy as CopyData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import {
  type CitationItem,
  CitationList,
  CitationStack,
} from "@/components/agents/citations";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { useCopied } from "@/lib/hooks/use-copied";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { MessageReactions, type ReactionTarget } from "@/components/chat/message-reactions";
import { EmojiFeedback } from "@/components/chat/emoji-feedback";
import { RollingNumber } from "@/components/motion/rolling-number";
import type { FeedbackReactionId } from "@agent-hub/core";

export type StreamingResponseStatus = "streaming" | "complete" | "error";
export type StreamingResponseFeedback = FeedbackReactionId | null;

export interface StreamingResponseProps {
  /** Rendered response content. Pass plain text or the output of a Markdown renderer. */
  children: ReactNode;
  reactionTarget?: ReactionTarget;
  status?: StreamingResponseStatus;
  /** Plain-text value copied by the built-in copy action. */
  copyText?: string;
  /** Optional sources shown as a compact footer disclosure after streaming. */
  sources?: CitationItem[];
  feedback?: StreamingResponseFeedback;
  onFeedbackChange?: (feedback: StreamingResponseFeedback) => void;
  /** Set false when a surrounding conversation log announces streamed text. */
  announce?: boolean;
  /** Hides the built-in completion actions without changing response status. */
  showActions?: boolean;
  /**
   * Whether the action row offers answer reactions at all. Default true, which is every
   * chat surface that persists a vote. A channel transcript passes false: its
   * messages live in their own table with no feedback column, and reactions that
   * light up and store nothing are worse than none (#778).
   */
  showFeedback?: boolean;
  className?: string;
  /** Optional actions beside copy and feedback, such as reading aloud. */
  extraActions?: ReactNode;
}

function ResponseAction({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {

  return (
    <CieleButton variant="ghost" size="icon-sm"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={label === "Helpful" || label === "Not helpful" ? active : undefined}
      onClick={onClick}

      className={cn(
        "text-muted-foreground hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </CieleButton>
  );
}

export function StreamingResponse({
  children,
  status = "streaming",
  copyText,
  sources = [],
  feedback,
  onFeedbackChange,
  announce = true,
  showActions = true,
  showFeedback = true,
  className,
  extraActions,
  reactionTarget,
}: StreamingResponseProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const [copied, markCopied] = useCopied();
  const [internalFeedback, setInternalFeedback] =
    useState<StreamingResponseFeedback>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const currentFeedback = feedback === undefined ? internalFeedback : feedback;
  const streaming = status === "streaming";
  const complete = status === "complete";
  const canCopy = Boolean(copyText);
  const hasSources = sources.length > 0;
  const shouldShowActions =
    showActions && !streaming && (canCopy || complete || hasSources);
  const sourcesContentId = `${baseId}-sources`;
  const sourcePrefix = `response-source-${baseId.replace(/:/g, "")}`;

  const handleCopy = async () => {
    if (copyText) await navigator.clipboard?.writeText(copyText);
    markCopied();
  };

  const setFeedback = (value: StreamingResponseFeedback) => {
    if (feedback === undefined) setInternalFeedback(value);
    onFeedbackChange?.(value);
  };

  const response = (
    <div
      data-state={status}
      aria-busy={streaming}
      className={cn("w-full", className)}
    >
      <div
        aria-live={announce ? "polite" : "off"}
        className="text-sm leading-6 text-foreground/90 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/45 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5"
      >
        {children}
      </div>

      <AnimatePresence initial={false}>
        {shouldShowActions ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="mt-3"
          >
            <div className="flex items-center gap-0.5">
              {canCopy ? (
                <ResponseAction
                  label={copied ? "Copied" : "Copy response"}
                  onClick={handleCopy}
                >
                  <MorphIcon icon={copied ? CheckData : CopyData} size={14} />
                </ResponseAction>
              ) : null}
              {extraActions}
              {complete && showFeedback ? (
                <EmojiFeedback
                  value={currentFeedback}
                  onChange={setFeedback}
                />
              ) : null}
              {hasSources ? (
                <button
                  type="button"
                  aria-expanded={sourcesOpen}
                  aria-controls={sourcesContentId}
                  data-foley-toggle=""
                  onClick={() => setSourcesOpen(!sourcesOpen)}
                  className="group ml-1 inline-flex min-h-7 items-center gap-2 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CitationStack citations={sources} />
                  <span>
                    <RollingNumber value={sources.length} />{" "}
                    {sources.length === 1 ? "source" : "sources"}
                  </span>
                  <motion.span
                    aria-hidden="true"
                    animate={{ rotate: sourcesOpen ? 180 : 0 }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                    className="text-muted-foreground/50 group-hover:text-muted-foreground"
                  >
                    <ChevronDown className="size-3" />
                  </motion.span>
                </button>
              ) : null}
            </div>

            {hasSources ? (
              <AgentDisclosure
                id={sourcesContentId}
                open={sourcesOpen}
              >
                <CitationList
                  citations={sources}
                  idPrefix={sourcePrefix}
                  className="mt-2 rounded-xl bg-muted p-2"
                />
              </AgentDisclosure>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
  return reactionTarget && complete && showActions ? <MessageReactions key={reactionTarget.messageId} target={reactionTarget}>{response}</MessageReactions> : response;
}
