"use client";

import { useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { removeMemberAction, revokeInviteAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { isRedirectError } from "@/components/ui/confirm-delete-modal";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import type { MemberRow } from "@/lib/member-rows";
import { Button } from "@agent-hub/ui";

/**
 * The same two-step (warning -> slide-to-confirm) morphing modal the assistant
 * delete uses, retargeted at a Members-table row. A pending invite is revoked
 * rather than removed, but it goes through the identical gate, the row means
 * the same thing to an admin either way.
 */
export function RemoveMemberModal({
  row,
  open,
  onClose,
}: {
  row: MemberRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<"warning" | "confirm">("warning");
  const [busy, setBusy] = useState(false);

  const isInvite = row?.kind === "invite";
  const subject = row?.name ?? "";

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

  /** Rethrows, so a failed removal sends the handle back to the start. */
  async function handleRemove() {
    if (!row) return;
    setBusy(true);
    try {
      if (row.kind === "invite") await revokeInviteAction(row.subjectId);
      else await removeMemberAction(row.subjectId);
    } catch (error) {
      setBusy(false);
      if (isRedirectError(error)) throw error;
      toast.error(
        error instanceof Error
          ? error.message
          : isInvite
            ? "The invitation was not revoked"
            : "The member was not removed",
      );
      throw error;
    }
    toast.success(isInvite ? "Invitation revoked" : "Member removed");
    onClose();
  }

  return (
    <MorphingModal
      viewId={open && row ? view : null}
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
                {isInvite ? "Revoke" : "Remove"} &ldquo;{subject}&rdquo;?
              </h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {isInvite
                  ? "This permanently voids the invitation link and cannot be undone."
                  : "This permanently removes their access to this organization and cannot be undone."}
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
              <h3 className="text-base font-semibold">
                Confirm {isInvite ? "revocation" : "removal"}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Slide to permanently {isInvite ? "revoke" : "remove"} &ldquo;
                {subject}&rdquo;.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <SlideToConfirm
              onConfirm={handleRemove}
              label={isInvite ? "Slide to revoke" : "Slide to remove"}
              confirmedLabel={isInvite ? "Revoked" : "Removed"}
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
