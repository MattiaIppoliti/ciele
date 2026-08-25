"use client";

import { Label } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import type { CollectionOption } from "@/components/teammates/teammates-client";

/**
 * The Knowledge Scope picker: which Library Collections this Teammate may
 * search. Selecting nothing is a real answer, so the empty state says what it
 * means rather than nudging the Member to pick something.
 */
export function CollectionScopePicker({
  collections,
  selected,
  onChange,
}: {
  collections: CollectionOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string, on: boolean) {
    onChange(on ? [...selected, id] : selected.filter((c) => c !== id));
  }

  return (
    <div className="space-y-2">
      <Label>Knowledge</Label>
      {collections.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Your Library has no collections yet. This teammate will answer from
          its role alone until you add some.
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
          {collections.map((collection) => (
            <label
              key={collection.id}
              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <Checkbox
                checked={selected.includes(collection.id)}
                onCheckedChange={(on) => toggle(collection.id, on === true)}
              />
              {collection.name}
            </label>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        {selected.length === 0
          ? "Nothing selected: it answers from its role and says so when a question needs a source."
          : `Searches ${selected.length} collection${selected.length > 1 ? "s" : ""} and cites what it finds.`}
      </p>
    </div>
  );
}
