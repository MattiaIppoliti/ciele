import { allTasksOp, listProjectsOp } from "@ciele/ops";
import { projectProgress } from "@agent-hub/core";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, workPageContext } from "@/lib/work/work-page";
import { ProjectsIndex } from "@/components/work/projects-index";

export const dynamic = "force-dynamic";

/** The Projects index (#1053): every Project the viewer can see, with its progress. */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [context, all, tasks, query] = await Promise.all([
    workPageContext(),
    runPageOperation(listProjectsOp, { includeArchived: true }),
    runPageOperation(allTasksOp, {}),
    searchParams,
  ]);
  const progress = Object.fromEntries(
    all.map((project) => [project.id, projectProgress(tasks.tasks.filter((task) => task.projectId === project.id))])
  );
  return (
    <WorkShell context={context}>
      <ProjectsIndex
        projects={all.filter((project) => !project.archived)}
        archived={all.filter((project) => project.archived)}
        progress={progress}
        initialCreating={query.new === "project"}
      />
    </WorkShell>
  );
}
