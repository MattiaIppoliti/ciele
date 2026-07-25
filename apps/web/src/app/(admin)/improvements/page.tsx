import { ImprovementsBoard } from "@/components/improvements/improvements-board";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ImprovementsPage() {
  const { organizationId, role, db } = await requirePageMember();

  const [improvements, members] = await Promise.all([
    db.listImprovements(organizationId),
    db.listMembers(organizationId),
  ]);

  return (
    <ImprovementsBoard
      improvements={improvements}
      members={members.map((m) => ({ userId: m.userId, email: m.email }))}
      canEdit={canEdit(role)}
    />
  );
}
