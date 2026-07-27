"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { deleteAssistantAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";

const CONFIRMATION_WORD = "DELETE";

/**
 * Two-step delete confirmation (warning -> type-to-confirm) in the same
 * bottom-anchored morphing modal used by Publish.
 */
export function DeleteAssistantModal({
  assistantId,
  assistantTitle,
  open,
  onClose,
  onDeleted,
}: {
  assistantId: string;
  assistantTitle: string;
  open: boolean;
  onClose: () => void;
  /** Called after the server action succeeds (navigate / refresh here). */
  onDeleted: () => void;
}) {
  const [view, setView] = useState<"warning" | "confirm">("warning");
  const [confirmationText, setConfirmationText] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputId = useId();

  const isConfirmed = confirmationText === CONFIRMATION_WORD;

  // Reset to the first step each time the modal opens (adjust-during-render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setView("warning");
      setConfirmationText("");
    }
  }

  function close() {
    if (isPending) return;
    onClose();
  }

  function handleDelete() {
    if (!isConfirmed || isPending) return;
    startTransition(async () => {
      await deleteAssistantAction(assistantId);
      toast.success("Assistant deleted");
      onClose();
      onDeleted();
    });
  }

  return (
    <MorphingModal
      viewId={open ? view : null}
      onClose={close}
      placement="bottom"
    >
      {view === "warning" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="bg-destructive/10 text-destructive rounded-full p-2">
              <AnimatedIcon icon={TriangleAlert} size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">
                Delete &ldquo;{assistantTitle}&rdquo;?
              </h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                This permanently removes the assistant and cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setView("confirm")}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="bg-destructive/10 text-destructive rounded-full p-2">
              <AnimatedIcon icon={Trash2} size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">Confirm deletion</h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Type <strong>{CONFIRMATION_WORD}</strong>{" "}below to
                permanently delete &ldquo;{assistantTitle}&rdquo;.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Type {CONFIRMATION_WORD} to confirm</Label>
            <Input
              id={inputId}
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDelete();
              }}
              placeholder={CONFIRMATION_WORD}
              autoComplete="off"
              disabled={isPending}
            />
            {confirmationText && !isConfirmed ? (
              <p className="text-destructive text-xs">
                The text doesn&rsquo;t match. Type {CONFIRMATION_WORD} exactly.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setView("warning")}
              disabled={isPending}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!isConfirmed || isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete assistant
            </Button>
          </div>
        </div>
      )}
    </MorphingModal>
  );
}
