"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Send feedback" dialog opened from the chat header's ⋯ menu, shared by the
 * editor Preview panel and the production widget (see chat-header.tsx for why
 * the two surfaces share their chrome). How the feedback is persisted differs
 * per host (admin server action vs public widget endpoint), so the submit is
 * injected; everything the user sees lives here.
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
   * Persists the feedback. Resolve to `true` when saved (dialog closes and
   * clears), `false` to keep the dialog open (e.g. no conversation yet,
   * the host is expected to have toasted why). Rejections toast a generic
   * failure and keep the text so nothing is lost.
   */
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      if (await onSubmit(trimmed)) {
        toast.success("Thanks for your feedback!");
        onOpenChange(false);
        setText("");
      }
    } catch {
      toast.error("Could not send feedback");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Tell us how {nickname} is doing in this conversation.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What went well? What could be better?"
          className="min-h-28"
          maxLength={2000}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={sending || !text.trim()}>
            {sending ? "Sending..." : "Send feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
