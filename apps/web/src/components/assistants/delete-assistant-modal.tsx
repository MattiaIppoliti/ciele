"use client";

import { useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { deleteAssistantAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { isRedirectError } from "@/components/ui/confirm-delete-modal";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { Button } from "@agent-hub/ui";

/**
 * Two-step delete confirmation (warning -> slide-to-confirm) in the same
 * bottom-anchored morphing modal used by Publish.
 *
 * The second step used to ask for the word DELETE typed into a field. The
 * slide is the same bargain in one gesture: a deliberate act that a stray
 * click cannot produce, and one that works on a phone, where typing a word
 * into a modal to delete something is the worst version of this. It commits
 * only at the end of the track (`slide-to-confirm.tsx` explains why there is
 * no threshold to tune) and it is crossable from the keyboard.
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
  const [busy, setBusy] = useState(false);

  // Reset to the first step each time the modal opens (adjust-during-render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setView("warning");
  }

  function close() {
    if (busy) return;
    onClose();
  }

  /**
   * Rethrows, and that is the contract with the slide: a rejected promise is
   * what sends the handle back to the start, so a delete that failed leaves
   * something to slide again rather than a pill reading "Deleted".
   */
  async function handleDelete() {
    setBusy(true);
    try {
      await deleteAssistantAction(assistantId);
    } catch (error) {
      setBusy(false);
      // A server action's redirect() arrives as a throw the router must see.
      if (isRedirectError(error)) throw error;
      toast.error(
        error instanceof Error ? error.message : "The assistant was not deleted",
      );
      throw error;
    }
    toast.success("Assistant deleted");
    onClose();
    onDeleted();
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
                Slide to permanently delete &ldquo;{assistantTitle}&rdquo;.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <SlideToConfirm
              onConfirm={handleDelete}
              label="Slide to delete"
              confirmedLabel="Deleted"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setView("warning")}
              disabled={busy}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </MorphingModal>
  );
}
