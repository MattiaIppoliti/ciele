import type { Role, Teammate, TeammateRoutine } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { MemberOption } from "@/components/teammates/teammate-editors-picker";
import type { TeammateGovernanceState } from "@/components/teammates/teammate-grants-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";

export interface TeammateSettingsProps {
  collections: CollectionOption[];
  members: MemberOption[];
  governance: TeammateGovernanceState;
  projects: { id: string; name: string }[];
  learnings: string;
  routines: TeammateRoutine[];
}

/**
 * Everything the configuration form needs, read once.
 *
 * Two routes render that form, the chat's drawer and `/teammates/{id}/settings`
 * full width, and they have to hand it the same facts: a Teammate whose
 * grants, Projects or Routines were assembled differently in one of the two
 * would configure differently depending on which one you opened.
 */
export async function loadTeammateSettingsProps(
  db: Db,
  organizationId: string,
  teammate: Teammate
): Promise<TeammateSettingsProps> {
  const [collections, members, grants, learnings, projects, routines] =
    await Promise.all([
      db.listOrgCollections(organizationId),
      db.listMembers(organizationId),
      // What it may do (#770). Read for everyone who can open the page, because
      // an agent's capabilities are not a secret from the colleagues it works
      // with; only changing them is admin work.
      db.table("teammateGrants").list({ teammateId: teammate.id }),
      // Its Agent memory layer and the Projects it could attach to (#771).
      db.getMemoryDocument(organizationId, {
        scope: "agent",
        teammateId: teammate.id,
      }),
      db.table("projects").list({ organizationId }),
      db.table("teammateRoutines").list({ teammateId: teammate.id }),
    ]);

  return {
    collections: collections.map((c) => ({ id: c.id, name: c.name })),
    members: members
      .filter((member) => member.userId !== teammate.ownerId)
      .map((member) => ({
        userId: member.userId,
        label:
          [member.firstName, member.lastName].filter(Boolean).join(" ") ||
          member.username ||
          member.email,
        // A Viewer named here would still be refused by `canEditTeammate`:
        // the org Role is the ceiling, so the picker says so up front.
        canEdit: member.role !== "viewer",
      })),
    governance: {
      domains: grants.map((grant) => grant.domain),
      ceiling: teammate.capabilityCeiling,
      approvalBypass: teammate.approvalBypass,
    },
    learnings: learnings?.body ?? "",
    routines,
    projects: projects
      // Archived projects keep their decisions and stop feeding them to a
      // model, so attaching to one would be attaching to nothing.
      .filter((project) => !project.archived)
      .map((project) => ({ id: project.id, name: project.name })),
  };
}

/** The viewer shape both routes resolve a Teammate with. */
export type SettingsViewer = { userId: string; role: Role | null };
