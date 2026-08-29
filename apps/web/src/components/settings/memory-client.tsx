"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MemoryDocumentEntry } from "@agent-hub/core";
import {
  MEMORY_DOCUMENT_MAX_CHARS,
  memoryDocumentChanges,
} from "@agent-hub/core";
import { Button, Label } from "@agent-hub/ui";
import { Undo2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { MEMORY_EMPTY_HINT, revertLabel } from "@/lib/teammates/memory-copy";
import { MemoryHistory } from "@/components/teammates/memory-history";
import {
  revertMyMemoryAction,
  writeMyMemoryAction,
} from "@/app/(admin)/settings/memory/actions";

/**
 * The Member's own memory document, with the history of every write to it
 * (#771, story 19).
 *
 * The history is not a nicety here, it is the point: a Teammate can change
 * what the platform remembers about a person mid-conversation, and the answer
 * to "why does it think that" has to be one click away, with an undo beside
 * it. All copy lives in `lib/teammates/memory-copy.ts`, where it is tested.
 */
export function MemoryClient({
  body: initial,
  entries,
  teammateNames,
}: {
  body: string;
  entries: MemoryDocumentEntry[];
  teammateNames: Record<string, string>;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const dirty = body !== initial;
  /**
   * Each write paired with the text it produced (#767, story 19's "what").
   * Against `initial` rather than the edited `body`: the history describes
   * writes that have landed, and comparing the newest one to an unsaved draft
   * would attribute the Member's current typing to whoever wrote before them.
   */
  const changes = memoryDocumentChanges(entries, initial);

  function save() {
    startTransition(async () => {
      try {
        await writeMyMemoryAction(body);
        toast.success("Saved, your teammates read it from the next message");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save");
      }
    });
  }

  function revert(entry: MemoryDocumentEntry) {
    startTransition(async () => {
      try {
        const restored = await revertMyMemoryAction(entry.id);
        setBody(restored.body);
        toast.success("Undone");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not undo");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="memory-body">Your profile</Label>
        <Textarea
          id="memory-body"
          value={body}
          rows={10}
          placeholder={MEMORY_EMPTY_HINT}
          onChange={(e) =>
            setBody(e.target.value.slice(0, MEMORY_DOCUMENT_MAX_CHARS))
          }
        />
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span>
            {body.length} / {MEMORY_DOCUMENT_MAX_CHARS} characters
          </span>
          <Button
            size="sm"
            disabled={!dirty || isPending}
            onClick={save}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>History</Label>
        <MemoryHistory
          changes={changes}
          teammateNames={teammateNames}
          emptyHint="No changes yet. Every write shows here, with who made it and what it changed."
          renderAction={({ entry }) => (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => revert(entry)}
            >
              <Undo2 className="size-4" />
              {revertLabel(entry)}
            </Button>
          )}
        />
      </div>
    </div>
  );
}
