import type { ReactNode } from "react";
import { todayUtc, workDirectoryOp, type WorkDirectory } from "@ciele/ops";
import { requirePageMember } from "@/lib/authz";
import { runPageOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";
import { WorkDirectoryProvider } from "@/components/work/work-directory";

/**
 * What every work page renders inside (#1063): the directory of people,
 * Labels and Projects the viewer can see, the viewer, whether they may edit,
 * and "today" as the server saw it, so dates read the same after hydration.
 */
export interface WorkPageContext {
  directory: WorkDirectory;
  viewerId: string;
  canEdit: boolean;
  today: string;
}

export async function workPageContext(): Promise<WorkPageContext> {
  const { session, role } = await requirePageMember();
  const directory = await runPageOperation(workDirectoryOp, {});
  return { directory, viewerId: session.userId, canEdit: canEdit(role), today: todayUtc() };
}

export function WorkShell({ context, children }: { context: WorkPageContext; children: ReactNode }) {
  return (
    <WorkDirectoryProvider
      directory={context.directory}
      today={context.today}
      viewerId={context.viewerId}
      canEdit={context.canEdit}
    >
      {children}
    </WorkDirectoryProvider>
  );
}

/** `?task=` from a page's search params. */
export function openTaskParam(params: Record<string, string | string[] | undefined>): string | null {
  const value = params.task;
  const id = Array.isArray(value) ? value[0] : value;
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
