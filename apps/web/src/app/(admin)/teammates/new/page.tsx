import { CreateTeammatePage } from "@/components/teammates/teammates-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { notFound } from "next/navigation";
import { loadScopeSources } from "@/lib/teammates/settings-props";

export default async function NewTeammatePage() {
  const { organizationId, role, db } = await requirePageMember();
  if (!canEdit(role)) notFound();
  const [collections, library, projects] = await Promise.all([
    db.listOrgCollections(organizationId),
    loadScopeSources(db, organizationId),
    db.table("projects").list({ organizationId }),
  ]);
  return <CreateTeammatePage collections={collections.map(({ id, name }) => ({ id, name }))} sources={library.sources} sourcesTruncated={library.truncated} projects={projects.filter((project) => !project.archived).map(({ id, name }) => ({ id, name }))} />;
}
