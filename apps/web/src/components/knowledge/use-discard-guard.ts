"use client";

import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

/**
 * One guard for every Library dialog that holds typed input. Escape, a
 * backdrop click and Cancel all go through `requestClose`, which asks before
 * throwing the input away, and a reload while dirty gets the browser's prompt.
 * Render `confirmDeleteModal` beside the dialog.
 */
export function useDiscardGuard({
  open,
  dirty,
  pending = false,
  onClose,
  description = "What you entered here is not saved yet.",
}: {
  open: boolean;
  dirty: boolean;
  /** A request in flight closes the dialog itself; asking then would race it. */
  pending?: boolean;
  onClose: () => void;
  description?: string;
}) {
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const { leave } = useUnsavedChanges({
    dirty: open && dirty,
    saving: pending,
    confirmDelete,
    description,
  });
  const requestClose = () => leave(onClose);

  return { requestClose, confirmDeleteModal };
}
