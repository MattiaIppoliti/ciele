import { ProjectsClient } from "@/components/projects/projects-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Projects (#771): where decisions that belong to the work live, instead of in
 * whichever conversation they were made in.
 *
 * One page rather than a directory plus a detail route: a Project is a name, a
 * description, a flag and one document, and splitting four fields across two
 * pages would be ceremony. If it grows, the detail route is the split.
 */
export default async function ProjectsPage() {
  const { db, organizationId, role } = await requirePageMember();

  const projects = await db.table("projects").list({ organizationId });
  const documents = await Promise.all(
    projects.map((project) =>
      db.getMemoryDocument(organizationId, {
        scope: "project",
        projectId: project.id,
      })
    )
  );
  // The history of each decisions document (#767, story 24: "with history").
  // A Teammate writes here mid-conversation, so "who decided this, and when"
  // has to be answerable from the Project rather than from whichever
  // transcript it happened in.
  const histories = await Promise.all(
    documents.map((document) =>
      document ? db.listMemoryDocumentEntries(document.id) : []
    )
  );
  const teammates = await db.table("teammates").list({ organizationId });

  return (
    <ProjectsClient
      canEdit={canEdit(role)}
      teammateNames={Object.fromEntries(
        teammates.map((teammate) => [teammate.id, teammate.name])
      )}
      projects={projects.map((project, index) => ({
        project,
        body: documents[index]?.body ?? "",
        entries: histories[index] ?? [],
        // Which Teammates read this Project's decisions each turn. Shown
        // because archiving or deleting one is a decision about them too.
        attached: teammates
          .filter((t) => t.projectId === project.id && !t.deletedAt)
          .map((t) => ({ id: t.id, name: t.name })),
      }))}
    />
  );
}
