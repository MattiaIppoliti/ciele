"use client";

import { Label } from "@agent-hub/ui";

/**
 * Which Project a Teammate reads the decisions of (#771, story 23).
 *
 * At most one, so a radio list rather than checkboxes: a Teammate reading
 * three projects every turn would answer from a blend of contexts nobody asked
 * it to combine, and "which decisions apply here" would stop having an answer.
 *
 * Archived Projects are not offered. They keep their decisions and stop
 * feeding them to a model, so attaching to one would be attaching to nothing.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: { id: string; name: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Project</Label>
      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No live projects yet. A project gives this teammate the decisions your
          team has already made, so it stops asking.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              value === null
                ? "border-primary ring-primary/30 ring-1"
                : "hover:bg-muted/50"
            }`}
          >
            None
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onChange(project.id)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                value === project.id
                  ? "border-primary ring-primary/30 ring-1"
                  : "hover:bg-muted/50"
              }`}
            >
              {project.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
