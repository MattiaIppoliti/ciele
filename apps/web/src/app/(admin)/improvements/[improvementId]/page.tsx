import { notFound } from "next/navigation";
import { roleAllowsCapability } from "@agent-hub/core";
import { createTaskOp, listTasksOp } from "@ciele/ops";
import { PageCrumb } from "@/components/shell/top-bar-slots";
import { ImprovementDetail } from "@/components/improvements/improvement-detail";
import { requirePageMember } from "@/lib/authz";
import { runPageOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";
import { improvementTaskRows } from "@/lib/work/improvement-tasks";

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

  const [associationPage, members, proposal, projects, tasks] = await Promise.all([
    db.getImprovementAssociationPage(improvement.id, { limit: 1 }),
    db.listMembers(organizationId),
    db.getImprovementProposal(improvement.id),
    db.table("projects").list({ organizationId }),
    // ADR-0027 rule 2: the detail lists its Tasks, archived ones too, from
    // the Projects the viewer can read (the operation filters the rest).
    runPageOperation(listTasksOp, { improvementId: improvement.id, includeArchived: true }),
  ]);

  return (
    <>
      <PageCrumb label={improvement.title} />
    <ImprovementDetail
      improvement={improvement}
      associationPage={associationPage}
      members={members.map((m) => ({ userId: m.userId, email: m.email }))}
      proposal={proposal}
      projects={projects
        // Archived projects have stopped being run; filing new work under one
        // would file it under something nobody is looking at.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name }))}
      tasks={improvementTaskRows(tasks.items, projects)}
      canEdit={canEdit(role)}
      // Linking is a Task write (rule 2): the rank `tasks.create` declares,
      // not the Editor rank on Improvements, even while the two coincide.
      canCreateTasks={roleAllowsCapability(role, createTaskOp.capability)}
    />
    </>
  );
}
