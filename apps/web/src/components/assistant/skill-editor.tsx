"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Skill } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { RollInText } from "@/components/motion/roll-in-text";
import { createSkillAction, updateSkillAction } from "@/app/actions";
import { canAutoFocus } from "@/lib/auto-focus";
import { toast } from "@/lib/toast";

type SkillFields = Pick<Skill, "name" | "description" | "prompt"> & { starter: string };

const EMPTY: SkillFields = { name: "", description: "", prompt: "", starter: "" };

// Borderless, like the Project view: the page is the document and the fields
// are its lines, so focus shows as an underline rather than a box.
const LINE_FOCUS =
  "focus-visible:underline focus-visible:decoration-ring focus-visible:decoration-2 focus-visible:underline-offset-4";

/**
 * One Skill as a page under Tools & Skills, created and edited in the same
 * view (the Project view's shape: a title line, a one-line description, the
 * body, and a boxed section for the optional part). It replaced a dialog,
 * which had no room for a prompt of any length and no place in the breadcrumb.
 *
 * Save and Cancel sit in the top bar beside the breadcrumb, the page's
 * committing action. A new Skill is attached to the Assistant it was opened
 * from, as the dialog did; either way the page returns to Tools & Skills.
 */
export function SkillEditor({
  assistantId,
  skill,
}: {
  assistantId: string;
  /** The Skill to edit, or null to create one. */
  skill: Skill | null;
}) {
  const router = useRouter();
  const loaded: SkillFields = skill
    ? {
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt,
        starter: skill.starter ?? "",
      }
    : EMPTY;
  const [draft, setDraft] = useState<SkillFields>(loaded);
  const [pending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const back = `/assistants/${assistantId}/tools`;
  const nameRef = useRef<HTMLInputElement>(null);

  // Focused after mount, not through `autoFocus`: whether to focus depends on
  // the pointer (`canAutoFocus`), which the server cannot know, and the two
  // renders disagreeing is a hydration mismatch.
  useEffect(() => {
    if (!skill && canAutoFocus()) nameRef.current?.focus();
  }, [skill]);

  const dirty = (Object.keys(loaded) as (keyof SkillFields)[]).some(
    (key) => draft[key] !== loaded[key]
  );

  const { leave } = useUnsavedChanges({
    dirty,
    confirmDelete,
    saving: pending,
    description: skill
      ? "The edits to this skill are not saved yet."
      : "This skill has not been created yet.",
  });

  function save() {
    const name = draft.name.trim();
    if (!name || !draft.prompt.trim()) {
      toast.error("Skill name and prompt are required");
      return;
    }
    const fields = {
      name,
      description: draft.description.trim(),
      prompt: draft.prompt,
      starter: draft.starter.trim(),
    };
    startTransition(async () => {
      try {
        if (skill) {
          await updateSkillAction(skill.id, fields);
          toast.success("Skill updated");
        } else {
          await createSkillAction(fields, assistantId);
          toast.success("Skill created and attached");
        }
        router.push(back);
      } catch (error) {
        // The draft stays, so a failure can be retried as it was.
        toast.error(error instanceof Error ? error.message : "Could not save the skill");
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      {confirmDeleteModal}
      <SlotPortal id={TOP_BAR_SLOT}>
        <Button
          variant="outline"
          className="h-8 rounded-lg px-3"
          disabled={pending}
          onClick={() => leave(() => router.push(back))}
        >
          Cancel
        </Button>
        <Button loading={pending} className="h-8 rounded-lg px-3 font-semibold" disabled={pending} onClick={save}>
          <RollInText text={pending ? "Saving…" : skill ? "Save skill" : "Create skill"} />
        </Button>
      </SlotPortal>

      <input
        ref={nameRef}
        aria-label="Skill name"
        placeholder="Skill name"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        className={`placeholder:text-muted-foreground w-full bg-transparent text-2xl font-semibold outline-none ${LINE_FOCUS}`}
      />
      <input
        aria-label="Description"
        placeholder="Add a short description…"
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        className={`placeholder:text-muted-foreground mt-2 w-full bg-transparent text-sm outline-none ${LINE_FOCUS}`}
      />

      <div className="mt-4 border-t pt-4">
        <Textarea
          aria-label="Prompt"
          placeholder="When citing internal policies, always name the official document and advise the user to verify with the relevant team…"
          value={draft.prompt}
          onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
          className="min-h-56 resize-none border-0 px-3.5 py-3 shadow-none focus-visible:ring-0 focus-visible:bg-muted/40"
        />

      </div>

      <section className="mt-6 rounded-lg border">
        <div className="border-b px-4 py-2.5">
          <p className="text-sm font-medium">Opening line (optional)</p>
        </div>
        <div className="p-3">
          <Textarea
            aria-label="Opening line"
            rows={2}
            placeholder="Draft release notes for the change I paste below."
            value={draft.starter}
            onChange={(event) => setDraft({ ...draft, starter: event.target.value })}
            className="resize-none border-0 px-1 shadow-none focus-visible:ring-0"
          />
          <p className="text-muted-foreground mt-2 px-1 text-xs">
            Filled into the composer from the <code>/</code> menu. Leave empty to hide.
          </p>
        </div>
      </section>
    </div>
  );
}
