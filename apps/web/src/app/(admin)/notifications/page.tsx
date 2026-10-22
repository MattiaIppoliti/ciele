import { notificationTriageOp } from "@ciele/ops";
import { runPageOperation } from "@/lib/operations";
import { WorkShell, workPageContext } from "@/lib/work/work-page";
import { NotificationsView } from "@/components/work/notifications-view";

export const dynamic = "force-dynamic";

/** A Member's own notifications (#1048, #1067): `/notifications`, `?n=` the open one. */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [context, items, query] = await Promise.all([
    workPageContext(),
    runPageOperation(notificationTriageOp, { limit: 300 }),
    searchParams,
  ]);
  const raw = Array.isArray(query.n) ? query.n[0] : query.n;
  const initialId = raw && items.some((item) => item.id === raw) ? raw : null;
  return (
    <WorkShell context={context}>
      <NotificationsView items={items} initialId={initialId} />
    </WorkShell>
  );
}
