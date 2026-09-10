import type { Role, SourceKind, Teammate, TeammateRoutine } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { MemberOption } from "@/components/teammates/teammate-editors-picker";
import type { TeammateGovernanceState } from "@/components/teammates/teammate-grants-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";
import { KNOWLEDGE_TAB_KINDS, KNOWLEDGE_TAB_SLUGS } from "@/lib/knowledge-hub";
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";

export interface TeammateSettingsProps {
  collections: CollectionOption[];
  /** The Library items a scope can name one at a time (PRD #726). */
  sources: ScopeSource[];
  /** More Library items exist than were loaded; the picker says so. */
  sourcesTruncated: boolean;
  members: MemberOption[];
  governance: TeammateGovernanceState;
  projects: { id: string; name: string }[];
  learnings: string;
  routines: TeammateRoutine[];
}

/** Every Source kind the Library lists, in tab order. */
const ALL_SOURCE_KINDS: SourceKind[] = KNOWLEDGE_TAB_SLUGS.flatMap(
  (slug) => KNOWLEDGE_TAB_KINDS[slug]
);

/**
 * How many Library items the scope picker offers.
 *
 * The database returns only identity fields for this bounded read. The cap is
 * a backstop rather than a page: silently stopping at it would look like an
 * empty Library, so the caller is told when it bit and the picker says so.
 */
export const SCOPE_SOURCE_LIMIT = 500;

/**
 * The Library as a scope picker sees it: id, name, kind, and the Collection the
 * item sits in, which is what lets the picker point out a redundant pick.
 *
 * Shared by the roster page and both configuration routes, because all three
 * name the same items and one of them reading a different list would put a
 * different answer on the card than in the form.
 */
export async function loadScopeSources(
  db: Db,
  organizationId: string
): Promise<{ sources: ScopeSource[]; truncated: boolean }> {
  const page = await db.listOrgKnowledgeSourceOptions(organizationId, {
    kinds: ALL_SOURCE_KINDS,
    limit: SCOPE_SOURCE_LIMIT,
  });
  return {
    sources: page.items.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      collectionId: item.collectionId,
    })),
    truncated: page.total > page.items.length,
  };
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
  const [collections, libraryItems, members, grants, learnings, projects, routines] =
    await Promise.all([
      db.listOrgCollections(organizationId),
      loadScopeSources(db, organizationId),
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
    sources: libraryItems.sources,
    sourcesTruncated: libraryItems.truncated,
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
