import { AllTasksPage, type SearchParams } from "../all-tasks-page";

export const dynamic = "force-dynamic";

/** All tasks on the Calendar (#1065). */
export default function AllTasksCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  return <AllTasksPage searchParams={searchParams} layout="calendar" />;
}
