"use client";

import { useEffect, useState } from "react";
import { memoryDocumentChanges } from "@agent-hub/core";
import { Plus, SquareArrowOutUpRight } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { ProjectPicker } from "@/components/teammates/project-picker";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { readProjectAction } from "@/app/actions";

/**
 * Which Project a Teammate reads the decisions of, and the way into that
 * Project (#771).
 *
 * The picker and a summary live here; creating and editing happen in the
 * Project view, which is one dialog for both. Editing a team's decisions in a
 * textarea wedged into an already-long settings form was the smaller half of
 * the surface, and keeping it in two places is how the two drift.
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
  /**
   * Projects created here, on top of the prop: the prop only refreshes with
   * the page, and a Project created in this form has to be attachable the
   * moment it exists.
   */
  const [created, setCreated] = useState<{ id: string; name: string }[]>([]);
  /** And the ones deleted here, hidden for the same reason. */
  const [removed, setRemoved] = useState<string[]>([]);
  /** Open in create mode (`null`) or on the attached Project. */
  const [dialog, setDialog] = useState<{ projectId: string | null } | null>(
    null
  );
  /**
   * Bumped when the dialog closes, so the summary below re-reads what was just
   * saved in it rather than showing the state it opened with.
   */
  const [reads, setReads] = useState(0);
  const [summary, setSummary] = useState<{
    id: string;
    description: string;
    decisions: number;
  } | null>(null);

  useEffect(() => {
    if (!value) return;
    // Guards the slow case: a response for a Project that is no longer the
    // attached one must not land over the one that is.
    let live = true;
    readProjectAction(value)
      .then(({ project, document, entries }) => {
        if (!live) return;
        setSummary({
          id: project.id,
          description: project.description,
          decisions: memoryDocumentChanges(entries, document?.body ?? "").length,
        });
      })
      .catch(() => {
        /* The dialog reports its own read failure; the summary just stays off. */
      });
    return () => {
      live = false;
    };
  }, [value, reads]);

  const options = [
    ...projects.filter((project) => !removed.includes(project.id)),
    ...created.filter(
      (project) =>
        !removed.includes(project.id) &&
        !projects.some((existing) => existing.id === project.id)
    ),
  ];
  const attached = summary && summary.id === value ? summary : null;

  return (
    <div className="space-y-3">
      <ProjectPicker projects={options} value={value} onChange={onChange} />

      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setDialog({ projectId: null })}
        >
          <Plus className="size-4" /> New project
        </Button>
      )}

      {value && (
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 text-sm">
            <p className="text-muted-foreground">
              {attached?.description ||
                "No summary yet. Open the project to say what it is about."}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {attached === null
                ? "Reading its decisions..."
                : attached.decisions === 0
                  ? "No decisions recorded yet."
                  : `${attached.decisions} decision${
                      attached.decisions > 1 ? "s" : ""
                    } recorded.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setDialog({ projectId: value })}
          >
            <SquareArrowOutUpRight className="size-4" /> Open
          </Button>
        </div>
      )}

      {dialog && (
        <ProjectDialog
          open
          projectId={dialog.projectId}
          teammateNames={teammateNames}
          onClose={() => {
            setDialog(null);
            setReads((n) => n + 1);
          }}
          onCreated={(project) => {
            setCreated((prev) => [...prev, project]);
            onChange(project.id);
          }}
          onDeleted={(deletedId) => {
            setRemoved((prev) => [...prev, deletedId]);
            if (value === deletedId) onChange(null);
          }}
        />
      )}
    </div>
  );
}
