"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyPlus, Ellipsis, Trash2 } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "sonner";
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
import { Hint } from "@agent-hub/ui";

/** Editor top-bar "More options" menu: Duplicate / Delete assistant. */
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

  if (!canEdit && !canDelete) return null;

  function handleDuplicate() {
    startTransition(async () => {
      const copy = await duplicateAssistantAction(assistantId);
      toast.success(`Duplicated as "${copy.title}"`);
      router.push(`/assistants/${copy.id}`);
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
        {canEdit && (
          <DropdownMenuItem onClick={handleDuplicate}>
            <AnimatedIcon icon={CopyPlus} size={16} /> Duplicate assistant
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            {canEdit && <DropdownMenuSeparator />}
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
