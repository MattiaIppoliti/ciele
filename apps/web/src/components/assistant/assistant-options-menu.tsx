"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyPlus, Trash2 } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { duplicateAssistantAction } from "@/app/actions";
import { DeleteAssistantModal } from "@/components/assistants/delete-assistant-modal";
import { Button } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyFeedbackIcon, Hint, useCopyFeedback } from "@agent-hub/ui";
import { RollInText } from "@/components/motion/roll-in-text";

/** Editor top-bar "More options" menu: Copy ID / Duplicate / Delete assistant. */
export function AssistantOptionsMenu({
  assistantId,
  assistantTitle,
  canEdit,
  canDelete,
}: {
  assistantId: string;
  assistantTitle: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { copyText, isCopied } = useCopyFeedback<"id">();
  const copied = isCopied("id");

  // Copy ID is here for every role: the header hides its standalone copy
  // button on a phone, so this menu is the only way to it there.
  async function copyId() {
    if (await copyText("id", assistantId)) toast.success("Assistant ID copied");
    else toast.error("Could not copy the assistant ID");
  }

  function handleDuplicate() {
    startTransition(async () => {
      try {
        const copy = await duplicateAssistantAction(assistantId);
        toast.success(`Duplicated as “${copy.title}”`);
        router.push(`/assistants/${copy.id}`);
      } catch {
        toast.error("Could not duplicate the assistant. Try again.");
      }
    });
  }

  return (
    <>
    <DropdownMenu>
      <Hint label="More options">
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="More options"
              disabled={isPending}
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end">
        <DropdownMenuItem closeOnClick={false} onClick={() => void copyId()}>
          <CopyFeedbackIcon copied={copied} className="size-4" />
          <RollInText text={copied ? "Copied" : "Copy ID"} />
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onClick={handleDuplicate}>
            <AnimatedIcon icon={CopyPlus} size={16} /> Duplicate assistant
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <AnimatedIcon icon={Trash2} size={16} /> Delete assistant
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <DeleteAssistantModal
      assistantId={assistantId}
      assistantTitle={assistantTitle}
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      onDeleted={() => router.push("/")}
    />
    </>
  );
}
