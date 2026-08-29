"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MEMORY_DOCUMENT_MAX_CHARS,
  memoryDocumentChanges,
} from "@agent-hub/core";
import type { MemoryDocumentEntry } from "@agent-hub/core";
import { Archive, ArchiveRestore, ChevronRight, Trash2, X } from "lucide-react";
import { Button, Dialog, DialogContent, Skeleton } from "@agent-hub/ui";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { FoldersIcon } from "@/components/ui/icons/folders";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { MemoryHistory } from "@/components/teammates/memory-history";
import {
  createProjectAction,
  deleteProjectAction,
  readProjectAction,
  updateProjectAction,
  writeProjectDocumentAction,
} from "@/app/actions";

/**
 * The Project view (#771): one screen for a Project's name, what it is about,
 * the decisions it holds, and the history of every write to them.
 *
 * The same dialog creates and edits, because a Project being created and a
 * Project being read are the same four facts; a separate "new project" form
 * would be a second place for those fields to drift. What changes with the
 * mode is the button at the end and whether the history has anything in it.
 *
 * History sits at the bottom rather than behind a disclosure because it is the
 * answer to "when did we settle that", and a Teammate writes here
 * mid-conversation: without it that answer is buried in whichever transcript it
 * happened in (#767, story 24).
 */
export function ProjectDialog({
  open,
  projectId,
  teammateNames = {},
  onClose,
  onCreated,
  onDeleted,
}: {
  open: boolean;
  /** The Project to open, or null to create one. */
  projectId: string | null;
  /** Teammate id → name, so a decision is attributed to a colleague. */
  teammateNames?: Readonly<Record<string, string>>;
  onClose: () => void;
  /** The new Project, so the caller can attach what it was opened from. */
  onCreated?: (project: { id: string; name: string }) => void;
  onDeleted?: (projectId: string) => void;
}) {
  const router = useRouter();
  const creating = projectId === null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [archived, setArchived] = useState(false);
  const [entries, setEntries] = useState<MemoryDocumentEntry[]>([]);
  /** What the read returned, so a save writes only what actually changed. */
  const [saved, setSaved] = useState<{ description: string; body: string } | null>(
    null
  );
  const [unreadable, setUnreadable] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!projectId) return;
    // Guards the slow case: a response for a Project that is no longer the one
    // on screen must not land over the one that is.
    let live = true;
    readProjectAction(projectId)
      .then(({ project, document, entries: history }) => {
        if (!live) return;
        setName(project.name);
        setDescription(project.description);
        setArchived(project.archived);
        setBody(document?.body ?? "");
        setEntries(history);
        setSaved({
          description: project.description,
          body: document?.body ?? "",
        });
      })
      .catch(() => {
        if (live) setUnreadable(true);
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  function run(work: () => Promise<unknown>, done: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(done);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong"
        );
      }
    });
  }

  function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Your project needs a name");
      return;
    }
    run(async () => {
      const project = await createProjectAction({
        name: trimmed,
        description: description.trim(),
      });
      // Only when there is something to record: an empty document must not
      // open its history with an entry saying somebody wrote nothing.
      if (body.trim()) await writeProjectDocumentAction(project.id, body);
      onCreated?.({ id: project.id, name: project.name });
      onClose();
    }, "Project created");
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || !projectId || !saved) return;
    run(async () => {
      await updateProjectAction(projectId, {
        name: trimmed,
        description: description.trim(),
      });
      // A separate document, written only when it changed: an untouched one
      // must not gain a history entry saying somebody edited it.
      if (body !== saved.body) {
        await writeProjectDocumentAction(projectId, body);
      }
      onClose();
    }, "Saved, attached teammates read it from the next message");
  }

  // Against the saved body, not the textarea: history describes writes that
  // landed, and the newest one did not produce whatever is being typed now.
  const changes = saved ? memoryDocumentChanges(entries, saved.body) : [];
  const loading = !creating && saved === null && !unreadable;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
            <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-md">
              <AnimatedGlyph icon={FoldersIcon} size={14} />
            </span>
            <span>Projects</span>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground truncate font-medium">
              {creating ? "New project" : name || "Project"}
            </span>
            {archived && (
              <span className="text-muted-foreground ml-1 text-xs">
                (archived, teammates no longer read it)
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close project"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </header>

        {loading ? (
          <div className="flex-1 space-y-4 px-6 py-6" aria-busy="true">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : unreadable ? (
          <p className="text-muted-foreground flex-1 px-6 py-10 text-center text-sm">
            Could not read this project. Close and open it again to retry.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {/* Borderless, because this reads as the project's own title
                rather than a field of a form. */}
            <input
              autoFocus={creating}
              value={name}
              placeholder="Project name"
              aria-label="Project name"
              onChange={(e) => setName(e.target.value.slice(0, 120))}
              className="placeholder:text-muted-foreground w-full bg-transparent text-2xl font-semibold outline-none"
            />
            <input
              value={description}
              placeholder="Add a short summary..."
              aria-label="Short summary"
              onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
              className="placeholder:text-muted-foreground mt-2 w-full bg-transparent text-sm outline-none"
            />

            <div className="mt-4 border-t pt-4">
              <Textarea
                value={body}
                rows={12}
                placeholder="Write the decisions this project holds: conventions, names, the calls nobody should have to make twice."
                aria-label="Decisions"
                onChange={(e) =>
                  setBody(e.target.value.slice(0, MEMORY_DOCUMENT_MAX_CHARS))
                }
                /* Padded, not flush: at px-0 the first line of a decision sat
                   hard against the edge of the field with nothing to read
                   into, which is what the panel's own gutter gives every other
                   line on this screen. */
                className="min-h-48 resize-none border-0 px-3.5 py-3 shadow-none focus-visible:ring-0"
              />
              <p className="text-muted-foreground text-xs">
                {body.length} / {MEMORY_DOCUMENT_MAX_CHARS} characters. Every
                attached teammate reads this from its next message.
              </p>
            </div>

            {/* Where Linear puts milestones: what this project has decided, and
                when. Empty on a new one, and it says so rather than hiding. */}
            <section className="mt-5 rounded-lg border">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <p className="text-sm font-medium">
                  History
                  {changes.length > 0 ? ` (${changes.length})` : ""}
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto p-3">
                <MemoryHistory
                  changes={changes}
                  teammateNames={teammateNames}
                  emptyHint={
                    creating
                      ? "Nothing yet. Once this project exists, every decision recorded here, by you or by a teammate, shows up in this list."
                      : "Nothing written yet. Every decision recorded here, by you or by a teammate, shows up in this list."
                  }
                />
              </div>
            </section>
          </div>
        )}

        <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
          {!creating && projectId && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => updateProjectAction(projectId, { archived: !archived }),
                    archived ? "Restored" : "Archived, teammates no longer read it"
                  )
                }
              >
                {archived ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
                {archived ? "Restore" : "Archive"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={isPending}
                onClick={() => {
                  // Archiving keeps the record; deleting does not. The
                  // difference is worth one sentence before it happens.
                  if (
                    !confirm(
                      `Delete ${name}? Its decisions go with it, and every attached teammate and improvement detaches. Archive instead to keep the record.`
                    )
                  ) {
                    return;
                  }
                  run(async () => {
                    await deleteProjectAction(projectId);
                    onDeleted?.(projectId);
                    onClose();
                  }, "Project deleted");
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
          <Button variant="outline" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || isPending || loading}
            onClick={creating ? create : save}
          >
            {creating ? "Create project" : "Save"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
