"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUpRight, MessageSquare, X } from "lucide-react";

const OPEN_EASE = [0.34, 1.25, 0.64, 1] as const;
const CLOSE_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * "Send feedback" dialog opened from the chat header's ⋯ menu, shared by the
 * editor Preview panel and the production widget. It keeps the existing
 * conversation feedback record and also opens a prefilled email draft.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
  nickname,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nickname: string;
  /**
   * Persists the feedback when a conversation exists. Email composition is
   * handled here and still works when no conversation has started.
   */
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const reduce = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(
      () => textareaRef.current?.focus(),
      reduce ? 0 : 360,
    );
    return () => window.clearTimeout(timer);
  }, [open, reduce]);

  function mailtoHref() {
    const trimmed = text.trim();
    const subject = `Feedback for ${nickname} · Ciele`;
    const body = `Assistant: ${nickname}\n\nFeedback:\n${trimmed}`;
    return `mailto:hello@ciele.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function openEmailDraft() {
    const trimmed = text.trim();
    if (!trimmed) return;
    // The link opens the mail client synchronously. Persist in the background
    // as well, so existing conversation feedback remains available in Ciele.
    void Promise.resolve()
      .then(() => onSubmit(trimmed))
      .catch(() => {
        toast.error(
          "Could not save feedback to this conversation. The email draft is ready.",
        );
      });
    setText("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md border-0 bg-transparent p-2 shadow-none ring-0"
        overlayClassName="bg-black/35 supports-backdrop-filter:backdrop-blur-sm"
      >
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="feedback-modal"
              initial={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 16, scale: 0.97, filter: "blur(2px)" }
              }
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 12, scale: 0.98, filter: "blur(2px)" }
              }
              transition={
                reduce
                  ? { duration: 0.12 }
                  : {
                      duration: 0.36,
                      ease: OPEN_EASE,
                      opacity: { duration: 0.2, ease: CLOSE_EASE },
                    }
              }
              className="rounded-[20px] border border-border bg-background p-5 text-foreground shadow-2xl"
            >
              <div className="mb-4 flex items-start gap-3">
                <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                  <MessageSquare className="size-5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <DialogHeader className="gap-1.5">
                    <DialogTitle id="feedback-title">Send feedback</DialogTitle>
                    <DialogDescription>
                      Tell us how {nickname} is doing in this conversation.
                    </DialogDescription>
                  </DialogHeader>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close feedback"
                  className="text-muted-foreground hover:text-foreground -mr-1 -mt-1 flex size-8 max-lg:size-11 shrink-0 items-center justify-center rounded-full transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>

              <Textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Your feedback"
                placeholder="What went well? What could be better?"
                className="min-h-28 resize-y bg-muted/40"
                maxLength={2000}
              />
              <p className="text-muted-foreground mt-2 text-xs">
                Opens a draft to hello@ciele.app for you to review and send.
              </p>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-3 py-2 text-sm transition-colors"
                >
                  Cancel
                </button>
                <a
                  href={text.trim() ? mailtoHref() : undefined}
                  onClick={openEmailDraft}
                  aria-disabled={!text.trim()}
                  className={`bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-opacity ${text.trim() ? "hover:opacity-90" : "pointer-events-none opacity-50"}`}
                >
                  Open email <ArrowUpRight className="size-4" />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
