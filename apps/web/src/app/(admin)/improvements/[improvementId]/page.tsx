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

  const [associations, members, proposal] = await Promise.all([
    db.listImprovementMessages(improvement.id),
    db.listMembers(organizationId),
    db.getImprovementProposal(improvement.id),
  ]);

  return (
    <ImprovementDetail
      improvement={improvement}
      associations={associations}
      members={members.map((m) => ({ userId: m.userId, email: m.email }))}
      proposal={proposal}
      canEdit={canEdit(role)}
    />
  );
}
