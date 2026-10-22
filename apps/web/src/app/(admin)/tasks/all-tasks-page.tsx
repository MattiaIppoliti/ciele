import { allTasksOp } from "@ciele/ops";
import { workQueryFromParams, type WorkLayout } from "@agent-hub/core";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, openTaskParam, workPageContext } from "@/lib/work/work-page";
import { workViewDefaults } from "@/lib/work/work-format";
import { AllTasksView } from "@/components/work/work-views";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function layoutParam(value: string | string[] | undefined): WorkLayout {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "board" || raw === "table" ? raw : "list";
}

/**
 * The read and the render behind every All tasks route (#1050, #1065): every
 * Task in every Project the viewer can see. Calendar and Timeline are their
 * own addresses and name their layout; `/tasks` carries the other three in
 * `?layout=`.
 */
export async function AllTasksPage({
  searchParams,
  layout,
}: {
  searchParams: SearchParams;
  layout?: "calendar" | "timeline";
}) {
  const [context, all, query] = await Promise.all([workPageContext(), runPageOperation(allTasksOp, {}), searchParams]);
  const defaults = workViewDefaults("all-tasks");
  return (
    <WorkShell context={context}>
      <AllTasksView
        tasks={all.tasks}
        labelLinks={all.labelLinks}
        dependencies={all.dependencies}
        milestones={all.milestones}
        initialLayout={layout ?? layoutParam(query.layout)}
        initialCreating={query.new === "task"}
        defaults={defaults}
        initialQuery={workQueryFromParams(query, defaults)}
        initialTaskId={openTaskParam(query)}
      />
    </WorkShell>
  );
}
