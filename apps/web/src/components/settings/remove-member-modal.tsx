"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { removeMemberAction, revokeInviteAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import type { MemberRow } from "@/lib/member-rows";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";

const CONFIRMATION_WORD = "DELETE";

/**
 * The same two-step (warning -> type-to-confirm) morphing modal the assistant
 * delete uses, retargeted at a Members-table row. A pending invite is revoked
 * rather than removed, but it goes through the identical gate — the row means
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
  const [confirmationText, setConfirmationText] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputId = useId();

  const isConfirmed = confirmationText === CONFIRMATION_WORD;
  const isInvite = row?.kind === "invite";
  const subject = row?.name ?? "";

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

  function handleRemove() {
    if (!row || !isConfirmed || isPending) return;
    startTransition(async () => {
      if (row.kind === "invite") {
        await revokeInviteAction(row.subjectId);
        toast.success("Invitation revoked");
      } else {
        await removeMemberAction(row.subjectId);
        toast.success("Member removed");
      }
      onClose();
    });
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
                Type <strong>{CONFIRMATION_WORD}</strong> below to permanently{" "}
                {isInvite ? "revoke" : "remove"} &ldquo;{subject}&rdquo;.
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
                if (e.key === "Enter") handleRemove();
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
              onClick={handleRemove}
              disabled={!isConfirmed || isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {isInvite ? "Revoke invitation" : "Remove member"}
            </Button>
          </div>
        </div>
      )}
    </MorphingModal>
  );
}
