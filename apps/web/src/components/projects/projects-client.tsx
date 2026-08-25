"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MemoryDocumentEntry, Project } from "@agent-hub/core";
import {
  MEMORY_DOCUMENT_MAX_CHARS,
  memoryDocumentChanges,
} from "@agent-hub/core";
import { Archive, ArchiveRestore, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { MemoryHistory } from "@/components/teammates/memory-history";
import {
  createProjectAction,
  deleteProjectAction,
  updateProjectAction,
  writeProjectDocumentAction,
} from "@/app/(admin)/projects/actions";

export interface ProjectRow {
  project: Project;
  body: string;
  /** Every write to the decisions document, newest first (#767, story 24). */
  entries: MemoryDocumentEntry[];
  attached: { id: string; name: string }[];
}

/**
 * The Projects surface (#771).
 *
 * Each row shows which Teammates read its decisions, because archiving or
 * deleting a Project is a decision about them too: archiving stops them
 * reading it next turn, deleting detaches them entirely.
 */
export function ProjectsClient({
  projects,
  canEdit,
  teammateNames,
}: {
  projects: ProjectRow[];
  canEdit: boolean;
  /** Teammate id → name, so a decision is attributed to a colleague. */
  teammateNames: Record<string, string>;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-muted-foreground text-sm">
            Decisions that belong to the work, not to one conversation. A
            teammate attached to a project reads them every message.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setCreating((open) => !open)}>
            <Plus className="size-4" /> New project
          </Button>
        )}
      </div>

      {creating && (
        <div className="flex items-end gap-2 rounded-lg border p-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="new-project">Name</Label>
            <Input
              id="new-project"
              value={name}
              placeholder="Atlas"
              onChange={(e) => setName(e.target.value.slice(0, 120))}
            />
          </div>
          <Button
            disabled={!name.trim() || isPending}
            onClick={() =>
              run(async () => {
                await createProjectAction({ name: name.trim() });
                setName("");
                setCreating(false);
              }, "Project created")
            }
          >
            Create
          </Button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          <FolderOpen className="mx-auto mb-3 size-8 opacity-60" />
          <p className="font-medium">No projects yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm">
            A project holds what your team has settled: conventions, decisions,
            the things nobody should have to ask twice.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((row) => (
            <ProjectCard
              key={row.project.id}
              row={row}
              canEdit={canEdit}
              busy={isPending}
              run={run}
              teammateNames={teammateNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  row,
  canEdit,
  busy,
  run,
  teammateNames,
}: {
  row: ProjectRow;
  canEdit: boolean;
  busy: boolean;
  run: (work: () => Promise<unknown>, done: string) => void;
  teammateNames: Record<string, string>;
}) {
  const { project, attached } = row;
  const [body, setBody] = useState(row.body);
  const dirty = body !== row.body;
  // Against the saved body, not the textarea: history describes writes that
  // landed, and the newest one did not produce whatever is being typed now.
  const changes = memoryDocumentChanges(row.entries, row.body);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {project.name}
            {project.archived && (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                Archived, teammates no longer read it
              </span>
            )}
          </p>
          <p className="text-muted-foreground text-sm">
            {attached.length === 0
              ? "No teammate is attached yet."
              : `Read by ${attached.map((t) => t.name).join(", ")}.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    updateProjectAction(project.id, {
                      archived: !project.archived,
                    }),
                  project.archived ? "Restored" : "Archived"
                )
              }
            >
              {project.archived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {project.archived ? "Restore" : "Archive"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                // Archiving keeps the record; deleting does not. The
                // difference is worth one sentence before it happens.
                if (
                  !confirm(
                    `Delete ${project.name}? Its decisions go with it, and ${
                      attached.length === 1
                        ? "1 teammate is"
                        : `${attached.length} teammates are`
                    } attached. Archive instead to keep the record.`
                  )
                ) {
                  return;
                }
                run(() => deleteProjectAction(project.id), "Project deleted");
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`doc-${project.id}`}>Decisions</Label>
        <Textarea
          id={`doc-${project.id}`}
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
              disabled={!dirty || busy}
              onClick={() =>
                run(
                  () => writeProjectDocumentAction(project.id, body),
                  "Saved, attached teammates read it from the next message"
                )
              }
            >
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Who decided what, and when (#767, story 24). A Teammate writes here
          mid-conversation, so without this the answer to "when did we settle
          that" is buried in whichever transcript it happened in. */}
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
    </div>
  );
}
