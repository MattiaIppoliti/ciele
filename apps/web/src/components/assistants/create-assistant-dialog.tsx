"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { createAssistantAction } from "@/app/actions";
import { Button } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { canAutoFocus } from "@/lib/auto-focus";
import { isRedirectError, useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

export function CreateAssistantDialog({
  triggerLabel = "Create New Assistant",
}: {
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [description, setDescription] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const dirty =
    title.trim() !== "" || nickname.trim() !== "" || description.trim() !== "";

  function reset() {
    setTitle("");
    setNickname("");
    setDescription("");
    setTitleError(false);
  }

  // Escape, the backdrop and Cancel used to drop whatever was typed.
  function requestClose() {
    if (!dirty || isPending) {
      setOpen(false);
      return;
    }
    confirmDelete({
      title: "Discard this assistant?",
      description: "It has not been created yet.",
      confirmLabel: "Discard",
      onConfirm: () => {
        reset();
        setOpen(false);
      },
    });
  }

  useUnsavedChanges({ dirty: open && dirty });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
        // Redirects to the new assistant on success.
        await createAssistantAction({
          title: title.trim(),
          nickname: nickname.trim() || undefined,
          description: description.trim() || undefined,
        });
      } catch (error) {
        if (isRedirectError(error)) throw error;
        toast.error("Could not create the assistant. Try again.");
      }
    });
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : requestClose())}>
      <DialogTrigger render={<Button size="lg" className="px-4" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Assistant</DialogTitle>
          <DialogDescription>
            Set up a new assistant. You can configure everything else after
            creating it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-title">Assistant title</Label>
            <Input
              ref={titleRef}
              id="new-title"
              name="title"
              autoComplete="off"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim()) setTitleError(false);
              }}
              aria-invalid={titleError || undefined}
              aria-describedby={titleError ? "new-title-error" : undefined}
              placeholder="e.g. Customer Support Assistant"
              autoFocus={canAutoFocus()}
            />
            {titleError && (
              <p id="new-title-error" className="text-destructive text-sm">
                Give the assistant a title.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-nickname">Nickname</Label>
            <Input
              id="new-nickname"
              name="nickname"
              autoComplete="off"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Displayed on the assistant header"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-description">Description</Label>
            <Textarea
              id="new-description"
              name="description"
              autoComplete="off"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short overview of what this assistant does"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              <RollInText text={isPending ? "Creating…" : "Create assistant"} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}
