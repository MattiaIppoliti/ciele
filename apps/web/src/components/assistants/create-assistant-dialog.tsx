"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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

export function CreateAssistantDialog({
  triggerLabel = "Create New Assistant",
}: {
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    startTransition(async () => {
      await createAssistantAction({
        title: title.trim(),
        nickname: nickname.trim() || undefined,
        description: description.trim() || undefined,
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
              id="new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Customer Support Assistant"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-nickname">Nickname</Label>
            <Input
              id="new-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Displayed on the assistant header"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-description">Description</Label>
            <Textarea
              id="new-description"
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
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create assistant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
