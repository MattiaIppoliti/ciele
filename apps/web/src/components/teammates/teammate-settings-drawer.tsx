"use client";

import type { Teammate, TeammateRoutine } from "@agent-hub/core";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { TeammateSettingsForm } from "@/components/teammates/teammate-settings-form";
import type { MemberOption } from "@/components/teammates/teammate-editors-picker";
import type { TeammateGovernanceState } from "@/components/teammates/teammate-grants-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";

/**
 * The Teammate's configuration, beside its chat: the console's shared
 * `DetailDrawer` (overlay, resize handle, "Open full screen") with the same
 * form `/teammates/{id}/settings` renders full width.
 */
export function TeammateSettingsDrawer({
  teammate,
  collections,
  sources,
  sourcesTruncated,
  members,
  governance,
  canGrant,
  projects,
  learnings,
  routines,
  onClose,
}: {
  teammate: Teammate;
  collections: CollectionOption[];
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  members: MemberOption[];
  projects: { id: string; name: string }[];
  learnings: string;
  routines: TeammateRoutine[];
  governance: TeammateGovernanceState;
  canGrant: boolean;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      ariaLabel={`Configure ${teammate.name}`}
      fullScreenHref={`/teammates/${teammate.id}/settings`}
      resizeLabel="Resize teammate panel"
      defaultWidth={620}
      minWidth={420}
      maxWidth={1000}
      onClose={onClose}
    >
      <TeammateSettingsForm
        teammate={teammate}
        collections={collections}
        sources={sources}
        sourcesTruncated={sourcesTruncated}
        members={members}
        governance={governance}
        canGrant={canGrant}
        projects={projects}
        learnings={learnings}
        routines={routines}
        variant="drawer"
        onDone={onClose}
      />
    </DetailDrawer>
  );
}
