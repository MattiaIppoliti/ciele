"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useId } from "react";
import { Label } from "@agent-hub/ui";
import { onRadioKeyDown } from "@/lib/radio-keys";

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
  const labelId = useId();
  // One choice of several, so a radiogroup: `aria-pressed` said "toggle" to a
  // screen reader, and it is not one.
  const radio = (selected: boolean) => ({
    role: "radio",
    "aria-checked": selected,
    tabIndex: selected ? 0 : -1,
    onKeyDown: onRadioKeyDown,
    "data-foley-toggle": "switch",
  });
  return (
    <div className="space-y-2">
      <Label id={labelId}>Project</Label>
      {projects.length === 0 ? (
        <EmptyState size="sm" title="No projects yet" description="Create a project to share your team's decisions with this teammate." />
      ) : (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange(null)}
            {...radio(value === null)}
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
              {...radio(value === project.id)}
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
