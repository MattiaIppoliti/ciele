import { notFound } from "next/navigation";
import { projectWorkspaceOp } from "@ciele/ops";
import { workQueryFromParams } from "@agent-hub/core";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, openTaskParam, workPageContext } from "@/lib/work/work-page";
import { ProjectView } from "@/components/work/work-views";

export const dynamic = "force-dynamic";

/**
 * A Saved View's tab (#1050): the Project with the view's query and layout.
 * The URL still wins over the saved query, so a filtered link from this tab
 * reproduces what its sender saw.
 */
export default async function SavedViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; viewId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId, viewId }, query] = await Promise.all([params, searchParams]);
  const [context, workspace] = await Promise.all([
    workPageContext(),
    runPageOperation(projectWorkspaceOp, { id: projectId }),
  ]);
  const savedView = workspace.savedViews.find((view) => view.id === viewId);
  if (!savedView) notFound();
  return (
    <WorkShell context={context}>
      <ProjectView
        view={savedView.layout}
        savedView={savedView}
        workspace={workspace}
        defaults={savedView.query}
        initialQuery={workQueryFromParams(query, savedView.query)}
        initialTaskId={openTaskParam(query)}
      />
    </WorkShell>
  );
}
