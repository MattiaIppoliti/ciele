"use client";

import type { ProjectVisibility } from "@agent-hub/core";
import { RadioGroup } from "@/components/ui/radio-group";

/**
 * Who can see a Project, worded once: the create/edit dialog and the Share
 * dialog both ask it, and their two copies had drifted apart.
 */
export function ProjectVisibilityChoice({
  value,
  onChange,
  label = "Who can see it",
}: {
  value: ProjectVisibility;
  onChange: (value: ProjectVisibility) => void;
  label?: string;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as ProjectVisibility)}
      className="sm:grid-cols-2"
      options={[
        { value: "organization", label: "Everyone in the organization", hint: "Every Member can find and read it." },
        { value: "private", label: "Only its members", hint: "Members you add, plus Owners and Admins." },
      ]}
    />
  );
}
