import { isOverdue } from "@agent-hub/core";
import { countUnreadNotificationsOp, todayUtc, workDirectoryOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
import { requirePageMember } from "@/lib/authz";

/** What the sidebar's Work group shows (#1053): the My Tasks badge and the starred Projects. */
export interface SidebarWork {
  /** My open Tasks due today or overdue. */
  myTasksDue: number;
  /** Unread Member Notifications (#1067), the Notifications badge. */
  unreadNotifications: number;
  starredProjects: { id: string; name: string; icon: string; color: string; private: boolean }[];
}

const EMPTY: SidebarWork = { myTasksDue: 0, unreadNotifications: 0, starredProjects: [] };

/**
 * Best effort by design: the sidebar renders on every console page, so a
 * failure here (the deploy window before the work migration lands, a Viewer
 * session that reads nothing) leaves the group without its extras rather than
 * taking the shell down.
 */
export async function sidebarWork(): Promise<SidebarWork> {
  try {
    const { session, db } = await requirePageMember();
    const today = todayUtc();
    const [directory, unreadNotifications] = await Promise.all([
      runOperation(workDirectoryOp, {}),
      runOperation(countUnreadNotificationsOp, {}).catch(() => 0),
    ]);
    const visible = new Set(directory.projects.map((p) => p.id));
    const mine = await db.table("tasks").list({ assigneeMemberId: session.userId, archivedAt: null });
    const myTasksDue = mine.filter(
      (task) => visible.has(task.projectId) && task.status !== "done" && task.dueDate && (task.dueDate === today || isOverdue(task, today))
    ).length;
    const starred = new Set(directory.favorites.flatMap((f) => (f.projectId ? [f.projectId] : [])));
    return {
      myTasksDue,
      unreadNotifications,
      starredProjects: directory.projects
        .filter((p) => starred.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, private: p.visibility === "private" })),
    };
  } catch {
    return EMPTY;
  }
}
