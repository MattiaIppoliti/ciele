"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useState, useTransition } from "react";
import type { MemoryDocumentEntry } from "@agent-hub/core";
import {
  MEMORY_DOCUMENT_MAX_CHARS,
  memoryDocumentChanges,
} from "@agent-hub/core";
import { Button, Label } from "@agent-hub/ui";
import { Undo2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { formatCount } from "@/lib/format";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useSettingsDirty } from "@/components/settings/settings-dirty";
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
  updatedAt,
  entries,
  teammateNames,
}: {
  body: string;
  /** The loaded version, so a save over a newer write is refused, not applied. */
  updatedAt: string | null;
  entries: MemoryDocumentEntry[];
  teammateNames: Record<string, string>;
}) {
  const [body, setBody] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const dirty = body !== initial;
  useSettingsDirty(dirty);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
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
        await writeMyMemoryAction(body, "", updatedAt);
        toast.success("Saved, your teammates read it from the next message");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save");
      }
    });
  }

  async function restore(entry: MemoryDocumentEntry) {
    const restored = await revertMyMemoryAction(entry.id);
    setBody(restored.body);
    toast.success("Undone");
  }

  function revert(entry: MemoryDocumentEntry) {
    // The restored text replaces the textarea, so an unsaved draft would go
    // with it.
    if (dirty) {
      confirmDelete({
        title: "Discard your unsaved edits?",
        description:
          "Undoing this change replaces the text above with the restored version. What you typed since the last save is lost.",
        confirmLabel: "Discard and undo",
        onConfirm: () => restore(entry),
      });
      return;
    }
    startTransition(async () => {
      try {
        await restore(entry);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not undo");
      }
    });
  }

  return (
    <div className="mt-6">
      <SectionTimeline>
      <TimelineSection title="Your profile" boxed>
      <div className="space-y-2">
        <Label htmlFor="memory-body" className="sr-only">Your profile</Label>
        <Textarea
          id="memory-body"
          value={body}
          rows={10}
          placeholder={MEMORY_EMPTY_HINT}
          onChange={(e) => {
            const next = e.target.value;
            // A paste can overshoot the cap; say what was cut instead of
            // dropping the tail silently.
            if (next.length > MEMORY_DOCUMENT_MAX_CHARS) {
              toast.warning(
                `Only the first ${formatCount(MEMORY_DOCUMENT_MAX_CHARS)} characters were kept`,
              );
            }
            setBody(next.slice(0, MEMORY_DOCUMENT_MAX_CHARS));
          }}
        />
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span className="tabular-nums">
            <RollingNumber value={body.length} /> /{" "}
            {formatCount(MEMORY_DOCUMENT_MAX_CHARS)} characters
          </span>
          <Button loading={isPending}
            size="sm"
            disabled={!dirty || isPending}
            onClick={save}
          >
            <RollInText text={isPending ? "Saving…" : "Save"} />
          </Button>
        </div>
      </div>
      </TimelineSection>

      <TimelineSection title="History">
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
              <RollInText text={revertLabel(entry)} />
            </Button>
          )}
        />
      </TimelineSection>
      </SectionTimeline>
      {confirmDeleteModal}
    </div>
  );
}
