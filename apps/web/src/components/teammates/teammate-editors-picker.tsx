"use client";

import { Label } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";

export interface MemberOption {
  userId: string;
  label: string;
  /** Viewers are listed but not selectable: the org Role is the ceiling. */
  canEdit: boolean;
}

/**
 * Who may maintain this Teammate besides its owner (#768).
 *
 * A Viewer appears greyed rather than hidden, because "why is my colleague not
 * in this list" is a question about their Role, and hiding them makes it
 * unanswerable from here.
 */
export function TeammateEditorsPicker({
  members,
  selected,
  onChange,
}: {
  members: MemberOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(userId: string, on: boolean) {
    onChange(on ? [...selected, userId] : selected.filter((id) => id !== userId));
  }

  return (
    <div className="space-y-2">
      <Label>Who can maintain it</Label>
      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          You are the only member of this organization.
        </p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
          {members.map((member) => (
            <label
              key={member.userId}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                member.canEdit
                  ? "hover:bg-muted/50 cursor-pointer"
                  : "text-muted-foreground"
              }`}
            >
              <Checkbox
                checked={selected.includes(member.userId)}
                disabled={!member.canEdit}
                onCheckedChange={(on) => toggle(member.userId, on === true)}
              />
              {member.label}
              {!member.canEdit && (
                <span className="ml-auto text-xs">Viewer, read only</span>
              )}
            </label>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        The owner and the organization&apos;s admins can always maintain it.
      </p>
    </div>
  );
}
