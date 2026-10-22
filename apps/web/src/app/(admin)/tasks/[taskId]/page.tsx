import { getTaskOp, listProjectFilesOp, listTaskCommentsOp, projectWorkspaceOp, workActivityOp } from "@ciele/ops";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, workPageContext } from "@/lib/work/work-page";
import { PageCrumb } from "@/components/shell/top-bar-slots";
import { TaskPage } from "@/components/work/task-drawer";

export const dynamic = "force-dynamic";

/** One Task's full page (#1053): where a copied link lands and "Open full page" goes. */
export default async function TaskFullPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [context, detail, activity, comments] = await Promise.all([
    workPageContext(),
    runPageOperation(getTaskOp, { id: taskId }),
    runPageOperation(workActivityOp, { taskId, limit: 100 }),
    runPageOperation(listTaskCommentsOp, { taskId }),
  ]);
  const [workspace, files] = await Promise.all([
    runPageOperation(projectWorkspaceOp, { id: detail.project.id }),
    runPageOperation(listProjectFilesOp, { projectId: detail.project.id, taskId }),
  ]);
  return (
    <WorkShell context={context}>
      <PageCrumb label={detail.task.title} />
      <div className="h-full overflow-y-auto">
        <TaskPage detail={{ ...detail, activity, comments, files }} projectTasks={workspace.tasks} />
      </div>
    </WorkShell>
  );
}
