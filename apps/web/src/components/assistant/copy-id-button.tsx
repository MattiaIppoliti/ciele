"use client";

import { toast } from "sonner";
import {
  Button,
  CopyFeedbackIcon,
  Hint,
  useCopyFeedback,
} from "@agent-hub/ui";

export function CopyIdButton({ id }: { id: string }) {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const copied = isCopied(id);

  async function copyId() {
    if (await copyText(id, id)) toast.success("Assistant ID copied");
    else toast.error("Could not copy the assistant ID");
  }

  return (
    <Hint label={copied ? "Assistant ID copied" : "Copy assistant ID"}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={copied ? "Assistant ID copied" : "Copy assistant ID"}
        onClick={() => void copyId()}
      >
        <CopyFeedbackIcon copied={copied} className="size-4" />
      </Button>
    </Hint>
  );
}
