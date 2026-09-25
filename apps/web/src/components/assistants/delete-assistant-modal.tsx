"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { TriangleAlert } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { deleteAssistantAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { isRedirectError } from "@/components/ui/confirm-delete-modal";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { Button, Input, Label } from "@agent-hub/ui";

/**
 * Three-step delete confirmation (warning -> name -> slide) in the same
 * bottom-anchored morphing modal used by Publish. The assistant name must
 * match before the irreversible slider is shown.
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
  const [view, setView] = useState<"warning" | "name" | "confirm">("warning");
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset to the first step each time the modal opens (adjust-during-render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setView("warning");
      setTypedName("");
    }
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
      title={
        view === "warning"
          ? `Delete “${assistantTitle}”?`
          : "Confirm deletion"
      }
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
            <Button variant="destructive" onClick={() => setView("name")}>
              Continue
            </Button>
          </div>
        </div>
      ) : view === "name" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="bg-destructive/10 text-destructive rounded-full p-2">
              <AnimatedIcon icon={Trash2} size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">Confirm deletion</h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Type <span className="text-foreground font-medium">{assistantTitle}</span> to continue.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-assistant-name">Assistant name</Label>
            <Input
              id="confirm-assistant-name"
              autoFocus
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={assistantTitle}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setTypedName("");
                setView("warning");
              }}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => setView("confirm")}
              disabled={typedName.trim() !== assistantTitle.trim()}
            >
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
              onClick={() => setView("name")}
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
