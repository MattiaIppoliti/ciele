"use client";

import type { TeammateVisibility } from "@agent-hub/core";
import { Lock, Users } from "lucide-react";
import { Label } from "@agent-hub/ui";

const OPTIONS = [
  { value: "org", label: "The whole organization", icon: Users },
  { value: "private", label: "Only me and admins", icon: Lock },
] as const satisfies ReadonlyArray<{
  value: TeammateVisibility;
  label: string;
  icon: typeof Users;
}>;

/** Who sees a Teammate on their roster. Shared by the create and edit dialogs. */
export function VisibilityPicker({
  value,
  onChange,
}: {
  value: TeammateVisibility;
  onChange: (next: TeammateVisibility) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Who sees it</Label>
      <div className="flex gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              value === option.value
                ? "border-primary ring-primary/30 ring-1"
                : "hover:bg-muted/50"
            }`}
          >
            <option.icon className="size-4" />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
