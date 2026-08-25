"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MEMORY_DOCUMENT_MAX_CHARS,
  memoryDocumentChanges,
} from "@agent-hub/core";
import type { MemoryDocumentEntry } from "@agent-hub/core";
import { Archive, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { MemoryHistory } from "@/components/teammates/memory-history";
import { ProjectPicker } from "@/components/teammates/project-picker";
import {
  createProjectAction,
  deleteProjectAction,
  readProjectAction,
  updateProjectAction,
  writeProjectDocumentAction,
} from "@/app/(admin)/teammates/actions";

/**
 * The whole Projects surface (#771), inside the Teammate form it always served.
 *
 * A Project is only ever read by one Teammate, so this section is where one is
 * created, attached, and maintained: the picker over the live Projects, an
 * inline "new project" form (name plus what it is about), and, for the
 * selected one, its decisions document with the history of every write to it
 * (#767, story 24) — the versioning that used to justify a page of its own.
 *
 * The decisions document and its history are read when a Project is selected
 * rather than passed in, for the same reason the Agent memory layer is read on
 * open: a Teammate writes decisions mid-conversation, so a prop is only as
 * fresh as the page load underneath it.
 */
export function ProjectSection({
  projects,
  value,
  onChange,
  canEdit,
  teammateNames = {},
}: {
  /** Live Projects as the page rendered them; archived ones are not offered. */
  projects: { id: string; name: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
  canEdit: boolean;
  /** Teammate id → name, so a decision is attributed to a colleague. */
  teammateNames?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  /**
   * Projects created here, on top of the prop: the prop only refreshes with
   * the page, and a Project created in this form has to be attachable the
   * moment the toast lands.
   */
  const [created, setCreated] = useState<{ id: string; name: string }[]>([]);
  /** And the ones archived or deleted here, hidden for the same reason. */
  const [removed, setRemoved] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  /**
   * The last Project read, carrying the id it was read for: switching the
   * selection makes it stale rather than resetting it, so the editor below
   * disappears at render time and the effect only ever fetches.
   */
  const [loaded, setLoaded] = useState<{
    id: string;
    description: string;
    archived: boolean;
    savedBody: string;
    entries: MemoryDocumentEntry[];
  } | null>(null);
  const [body, setBody] = useState("");
  /** The id whose read failed, shown only while it is still the selected one. */
  const [unreadableId, setUnreadableId] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    // Guards the slow case: a response for a Project that is no longer the
    // selected one must not land over the one that is.
    let live = true;
    readProjectAction(value)
      .then(({ project, document, entries }) => {
        if (!live) return;
        setLoaded({
          id: project.id,
          description: project.description,
          archived: project.archived,
          savedBody: document?.body ?? "",
          entries,
        });
        setBody(document?.body ?? "");
      })
      .catch(() => {
        if (live) setUnreadableId(value);
      });
    return () => {
      live = false;
    };
  }, [value]);

  const detail = loaded && loaded.id === value ? loaded : null;
  const unreadable = unreadableId !== null && unreadableId === value;

  const options = [
    ...projects.filter((project) => !removed.includes(project.id)),
    ...created.filter(
      (project) =>
        !removed.includes(project.id) &&
        !projects.some((existing) => existing.id === project.id)
    ),
  ];

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
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      const project = await createProjectAction({
        name,
        description: newDescription.trim(),
      });
      setCreated((prev) => [...prev, { id: project.id, name: project.name }]);
      setNewName("");
      setNewDescription("");
      setCreating(false);
      onChange(project.id);
    }, "Project created");
  }

  // Against the saved body, not the textarea: history describes writes that
  // landed, and the newest one did not produce whatever is being typed now.
  const changes = detail
    ? memoryDocumentChanges(detail.entries, detail.savedBody)
    : [];
  const dirty = detail !== null && body !== detail.savedBody;

  return (
    <div className="space-y-3">
      <ProjectPicker projects={options} value={value} onChange={onChange} />

      {canEdit && (
        <div className="space-y-3">
          {!creating ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" /> New project
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-2">
                <Label htmlFor="new-project-name">Name</Label>
                <Input
                  id="new-project-name"
                  value={newName}
                  placeholder="Atlas"
                  onChange={(e) => setNewName(e.target.value.slice(0, 120))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-project-description">
                  What is it about?
                </Label>
                <Textarea
                  id="new-project-description"
                  value={newDescription}
                  rows={3}
                  placeholder="What this project does, the way you would tell a new colleague."
                  onChange={(e) =>
                    setNewDescription(e.target.value.slice(0, 2000))
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!newName.trim() || isPending}
                  onClick={create}
                >
                  Create project
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {value && unreadable && (
        <p className="text-muted-foreground text-sm">
          Could not read this project&apos;s decisions. Pick it again to retry.
        </p>
      )}

      {value && detail && (
        <div className="space-y-3 rounded-lg border p-3">
          {detail.description && (
            <p className="text-muted-foreground text-sm">
              {detail.description}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor={`project-decisions-${detail.id}`}>Decisions</Label>
            <Textarea
              id={`project-decisions-${detail.id}`}
              value={body}
              rows={6}
              disabled={!canEdit}
              placeholder="What has this team settled? Conventions, names, the calls nobody should have to make twice."
              onChange={(e) =>
                setBody(e.target.value.slice(0, MEMORY_DOCUMENT_MAX_CHARS))
              }
            />
            {canEdit && (
              <div className="text-muted-foreground flex items-center justify-between text-sm">
                <span>
                  {body.length} / {MEMORY_DOCUMENT_MAX_CHARS} characters
                </span>
                <Button
                  size="sm"
                  disabled={!dirty || isPending}
                  onClick={() =>
                    run(async () => {
                      await writeProjectDocumentAction(detail.id, body);
                      setLoaded({
                        ...detail,
                        savedBody: body,
                        // The entry the write just made is on the server; the
                        // reload below is what folds it into the history.
                        entries: (await readProjectAction(detail.id)).entries,
                      });
                    }, "Saved, attached teammates read it from the next message")
                  }
                >
                  Save
                </Button>
              </div>
            )}
          </div>

          {/* Who decided what, and when (#767, story 24). A Teammate writes
              here mid-conversation, so without this the answer to "when did we
              settle that" is buried in whichever transcript it happened in. */}
          <details className="space-y-2">
            <summary className="text-muted-foreground cursor-pointer text-sm hover:underline">
              History
              {changes.length > 0 ? ` (${changes.length})` : ""}
            </summary>
            <div className="mt-2">
              <MemoryHistory
                changes={changes}
                teammateNames={teammateNames}
                emptyHint="Nothing written yet. Every decision recorded here, by you or by a teammate, shows up in this list."
              />
            </div>
          </details>

          {canEdit && (
            <div className="flex gap-1 border-t pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    // Archiving keeps the record and stops every attached
                    // Teammate reading it next turn, so the picker drops it
                    // and the selection clears with it.
                    await updateProjectAction(detail.id, { archived: true });
                    setRemoved((prev) => [...prev, detail.id]);
                    onChange(null);
                  }, "Archived, teammates no longer read it")
                }
              >
                <Archive className="size-4" /> Archive
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
                      "Delete this project? Its decisions go with it, and every attached teammate detaches. Archive instead to keep the record."
                    )
                  ) {
                    return;
                  }
                  run(async () => {
                    await deleteProjectAction(detail.id);
                    setRemoved((prev) => [...prev, detail.id]);
                    onChange(null);
                  }, "Project deleted");
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
