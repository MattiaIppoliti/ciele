import { notFound } from "next/navigation";
import { listProjectFilesOp, projectWorkspaceOp, workActivityOp } from "@ciele/ops";
import { workQueryFromParams } from "@agent-hub/core";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, openTaskParam, workPageContext } from "@/lib/work/work-page";
import { workViewDefaults } from "@/lib/work/work-format";
import { ProjectView } from "@/components/work/work-views";
import { DEFAULT_PROJECT_VIEWS, type DefaultProjectView } from "@/lib/work/project-view-preference";

export const dynamic = "force-dynamic";

const VIEWS = DEFAULT_PROJECT_VIEWS;
type View = DefaultProjectView;

/** One view of one Project (#1053): `/projects/{id}/{view}`. */
export default async function ProjectViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId, view }, query] = await Promise.all([params, searchParams]);
  if (!VIEWS.includes(view as View)) notFound();
  const [context, workspace, activity, files] = await Promise.all([
    workPageContext(),
    runPageOperation(projectWorkspaceOp, { id: projectId }),
    // The workspace carries the latest 50 for the Overview; the Activity view reads further back.
    view === "activity" ? runPageOperation(workActivityOp, { projectId, limit: 300 }) : Promise.resolve(null),
    view === "files" ? runPageOperation(listProjectFilesOp, { projectId }) : Promise.resolve([]),
  ]);
  const defaults = workViewDefaults("project");
  return (
    <WorkShell context={context}>
      <ProjectView
        view={view as View}
        workspace={activity ? { ...workspace, activity } : workspace}
        files={files}
        defaults={defaults}
        initialQuery={workQueryFromParams(query, defaults)}
        initialTaskId={openTaskParam(query)}
      />
    </WorkShell>
  );
}
