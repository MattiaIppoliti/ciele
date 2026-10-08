"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { toast } from "@/lib/toast";
import { Button as CieleButton, Dialog, DialogContent, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUpRight, MessageSquare } from "lucide-react";

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
      reduce ? 0 : 180,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3">
          <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl border">
            <MessageSquare className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <DialogTitle id="feedback-title">Send feedback</DialogTitle>

          </div>
        </DialogHeader>
        <DialogBody>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Your feedback"
            placeholder="What went well? What could be better?"
            className="min-h-28 resize-y"
            maxLength={2000}
          />
          <p className="text-muted-foreground text-xs">
            Opens a draft to hello@ciele.app for you to review and send.
          </p>
        </DialogBody>
        <DialogFooter>
          <CieleButton
            variant="secondary"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </CieleButton>
          <CieleButton
            variant="primary"
            render={<a href={text.trim() ? mailtoHref() : undefined} />}
            onClick={openEmailDraft}
            aria-disabled={!text.trim()}
            disabled={!text.trim()}
          >
            Open email <ArrowUpRight className="size-4" />
          </CieleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
