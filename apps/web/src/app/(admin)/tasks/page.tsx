import { AllTasksPage, type SearchParams } from "./all-tasks-page";

export const dynamic = "force-dynamic";

/** All tasks (#1050) as a List, a Board or a Table. */
export default function AllTasksListPage({ searchParams }: { searchParams: SearchParams }) {
  return <AllTasksPage searchParams={searchParams} />;
}
