import { notFound } from "next/navigation";
import { ImprovementDetail } from "@/components/improvements/improvement-detail";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ImprovementDetailPage({
  params,
}: {
  params: Promise<{ improvementId: string }>;
}) {
  const { improvementId } = await params;
  const { organizationId, role, db } = await requirePageMember();

  const improvement = await db.getImprovement(improvementId);
  if (!improvement || improvement.organizationId !== organizationId) {
    notFound();
  }

  const [associations, members, proposal, projects] = await Promise.all([
    db.listImprovementMessages(improvement.id),
    db.listMembers(organizationId),
    db.getImprovementProposal(improvement.id),
    db.table("projects").list({ organizationId }),
  ]);

  return (
    <ImprovementDetail
      improvement={improvement}
      associations={associations}
      members={members.map((m) => ({ userId: m.userId, email: m.email }))}
      proposal={proposal}
      projects={projects
        // Archived projects have stopped being run; filing new work under one
        // would file it under something nobody is looking at.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name }))}
      canEdit={canEdit(role)}
    />
  );
}
