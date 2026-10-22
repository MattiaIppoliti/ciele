import { AllTasksPage, type SearchParams } from "../all-tasks-page";

export const dynamic = "force-dynamic";

/** All tasks on the Timeline (#1065). */
export default function AllTasksTimelinePage({ searchParams }: { searchParams: SearchParams }) {
  return <AllTasksPage searchParams={searchParams} layout="timeline" />;
}
