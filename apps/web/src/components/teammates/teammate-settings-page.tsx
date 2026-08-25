"use client";

import { useRouter } from "next/navigation";
import type { Teammate, TeammateRoutine } from "@agent-hub/core";
import { TeammateSettingsForm } from "@/components/teammates/teammate-settings-form";
import type { MemberOption } from "@/components/teammates/teammate-editors-picker";
import type { TeammateGovernanceState } from "@/components/teammates/teammate-grants-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";

/**
 * `/teammates/{id}/settings`: the configuration form full width.
 *
 * A client shell around the shared form for one reason, where the Member goes
 * when they are done. In the drawer that is "close"; here the form was the
 * whole screen, so leaving it means going back to the chat it configures.
 */
export function TeammateSettingsPage({
  teammate,
  collections,
  members,
  governance,
  canGrant,
  projects,
  learnings,
  routines,
}: {
  teammate: Teammate;
  collections: CollectionOption[];
  members: MemberOption[];
  projects: { id: string; name: string }[];
  learnings: string;
  routines: TeammateRoutine[];
  governance: TeammateGovernanceState;
  canGrant: boolean;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <TeammateSettingsForm
        teammate={teammate}
        collections={collections}
        members={members}
        governance={governance}
        canGrant={canGrant}
        projects={projects}
        learnings={learnings}
        routines={routines}
        variant="page"
        onDone={() => router.push(`/teammates/${teammate.id}`)}
      />
    </div>
  );
}
