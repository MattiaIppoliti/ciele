import { myTasksOp } from "@ciele/ops";
import { workQueryFromParams } from "@agent-hub/core";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, openTaskParam, workPageContext } from "@/lib/work/work-page";
import { workViewDefaults } from "@/lib/work/work-format";
import { MyTasksView } from "@/components/work/work-views";

export const dynamic = "force-dynamic";

/** My Tasks (#1050): what is assigned to me in every Project I can see. */
export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [context, mine, query] = await Promise.all([workPageContext(), runPageOperation(myTasksOp, {}), searchParams]);
  const defaults = workViewDefaults("my-tasks");
  return (
    <WorkShell context={context}>
      <MyTasksView
        tasks={mine.tasks}
        labelLinks={mine.labelLinks}
        improvements={mine.improvements}
        initialLayout={(Array.isArray(query.layout) ? query.layout[0] : query.layout) === "calendar" ? "calendar" : "list"}
        defaults={defaults}
        initialQuery={workQueryFromParams(query, defaults)}
        initialTaskId={openTaskParam(query)}
      />
    </WorkShell>
  );
}
