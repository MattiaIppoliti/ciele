import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import { mentionToken } from "@agent-hub/core";
import type { OperationContext, WorkActivityEntry, WorkNotificationRow } from "./operation";
import {
  createProjectOp,
  deleteProjectOp,
  duplicateProjectOp,
  listProjectsOp,
  setMilestonesOp,
  setProjectMembersOp,
  updateProjectOp,
} from "./projects-work";
import {
  archiveTaskOp,
  createTaskOp,
  deleteTaskOp,
  getTaskOp,
  listTasksOp,
  undoCompleteTaskOp,
  updateTaskOp,
} from "./tasks";
import { createTaskLabelOp } from "./task-labels";
import {
  createTaskCommentOp,
  deleteTaskCommentOp,
  listTaskCommentsOp,
  reactToTaskCommentOp,
  restoreTaskCommentOp,
  updateTaskCommentOp,
} from "./task-comments";
import { createSavedViewOp, deleteSavedViewOp, setFavoriteOp } from "./work-views";
import {
  archiveNotificationsOp,
  countUnreadNotificationsOp,
  deleteNotificationsOp,
  listMemberNotificationsOp,
  markNotificationsOp,
  notificationTriageOp,
  snoozeNotificationsOp,
} from "./member-notifications";
import { allTasksOp, myTasksOp, projectWorkspaceOp, workActivityOp, workDirectoryOp } from "./work-reads";
import {
  createProjectFileOp,
  discardProjectFileUploadOp,
  listProjectFilesOp,
  prepareProjectFileOp,
  renameProjectFileOp,
} from "./project-files";

/**
 * The work domain's operations (#1062) over the mock Db. The cases worth
 * having are the refusals (a private Project is `not_found`, a Viewer cannot
 * own work, a loop of dependencies is refused) and the side effects that must
 * happen exactly once (the next copy of a recurring Task, the Improvement's
 * move to In Review, a notification per recipient and never for the actor).
 */

const EDITOR = "u-martina";
const OTHER_EDITOR = "u-valeria";
const VIEWER = "u-marianna";
const ADMIN = "u-marco";

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "owner",
  db: getMockDb(),
  ...over,
});
const as = (userId: string, role: OperationContext["role"]) => ctx({ userId, role });

beforeEach(() => resetMockDb());

async function project(over: Parameters<typeof createProjectOp.run>[1] = { name: "Website", description: "" }) {
  return createProjectOp.run(as(EDITOR, "editor"), { ...over, description: over.description ?? "" });
}

describe("Projects", () => {
  it("derives a unique key and starts in progress (#1046)", async () => {
    const a = await project({ name: "Website Redesign", description: "" });
    const b = await project({ name: "Website Relaunch", description: "" });
    expect(a).toMatchObject({ key: "WR", status: "active", visibility: "organization" });
    expect(b.key).toBe("WR2");
  });

  it("derives past a key a private Project the caller cannot see already holds", async () => {
    const hidden = await createProjectOp.run(as(OTHER_EDITOR, "editor"), {
      name: "Website Hidden",
      description: "",
      key: "WE",
      visibility: "private",
    });
    // The mock reads every row, as a stale list would miss nothing: hide it the way RLS would.
    const db = getMockDb();
    const insert = db.table("projects").insert.bind(db.table("projects"));
    let clashes = 0;
    const viewOf = (c: OperationContext): OperationContext => ({
      ...c,
      db: new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "table") return Reflect.get(target, prop, receiver);
          return (name: string) => {
            const table = target.table(name as never) as unknown as Record<string, unknown>;
            if (name !== "projects") return table;
            return {
              ...table,
              list: async (filter: unknown) =>
                (await (table.list as (f: unknown) => Promise<{ id: string }[]>)(filter)).filter((row) => row.id !== hidden.id),
              insert: async (values: { key: string }) => {
                if (values.key === hidden.key) {
                  clashes += 1;
                  throw Object.assign(new Error("duplicate key value"), { code: "23505" });
                }
                return insert(values as never);
              },
            };
          };
        },
      }),
    });
    const made = await createProjectOp.run(viewOf(as(EDITOR, "editor")), { name: "Website", description: "" });
    expect(clashes).toBe(1);
    expect(made.key).not.toBe("WE");
    await expect(
      createProjectOp.run(viewOf(as(EDITOR, "editor")), { name: "Other", description: "", key: "WE" })
    ).rejects.toThrow(/already uses the key WE/);
  });

  it("refuses a key another Project uses", async () => {
    const a = await project({ name: "Alpha", description: "" });
    const b = await project({ name: "Beta", description: "" });
    await expect(updateProjectOp.run(as(EDITOR, "editor"), { id: b.id, patch: { key: a.key } })).rejects.toThrow(
      /already uses/
    );
  });

  it("hides a private Project from an Editor who is not on it, and not from an Admin", async () => {
    const secret = await project({ name: "Secret", description: "", visibility: "private" });
    const names = async (userId: string, role: OperationContext["role"]) =>
      (await listProjectsOp.run(as(userId, role), {})).map((p) => p.name);
    expect(await names(EDITOR, "editor")).toContain("Secret");
    expect(await names(OTHER_EDITOR, "editor")).not.toContain("Secret");
    expect(await names(ADMIN, "admin")).toContain("Secret");
    await expect(projectWorkspaceOp.run(as(OTHER_EDITOR, "editor"), { id: secret.id })).rejects.toThrow(/not found/);
    await setProjectMembersOp.run(as(EDITOR, "editor"), { id: secret.id, userIds: [EDITOR, OTHER_EDITOR] });
    expect(await names(OTHER_EDITOR, "editor")).toContain("Secret");
  });

  it("seats whoever makes a Project private, so they keep seeing it", async () => {
    const p = await project();
    await updateProjectOp.run(as(OTHER_EDITOR, "editor"), { id: p.id, patch: { visibility: "private" } });
    const visible = await listProjectsOp.run(as(OTHER_EDITOR, "editor"), {});
    expect(visible.map((x) => x.id)).toContain(p.id);
  });

  it("refuses work in an archived Project until it is restored", async () => {
    const p = await project();
    await updateProjectOp.run(as(EDITOR, "editor"), { id: p.id, patch: { archived: true } });
    await expect(createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x" })).rejects.toThrow(/archived/);
    await updateProjectOp.run(as(EDITOR, "editor"), { id: p.id, patch: { archived: false } });
    await expect(createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x" })).resolves.toBeTruthy();
  });

  it("keeps a private Project from its creator once they are removed in Share (#1047)", async () => {
    const p = await project({ name: "Secret", description: "", visibility: "private" });
    await setProjectMembersOp.run(as(EDITOR, "editor"), { id: p.id, userIds: [EDITOR, OTHER_EDITOR] });
    await setProjectMembersOp.run(as(OTHER_EDITOR, "editor"), { id: p.id, userIds: [OTHER_EDITOR] });
    const seen = await listProjectsOp.run(as(EDITOR, "editor"), {});
    expect(seen.map((x) => x.id)).not.toContain(p.id);
  });

  it("copies a Project's status when it is duplicated (#1046)", async () => {
    const p = await project();
    await updateProjectOp.run(as(EDITOR, "editor"), { id: p.id, patch: { status: "at_risk" } });
    const copy = await duplicateProjectOp.run(as(EDITOR, "editor"), { id: p.id });
    expect(copy.status).toBe("at_risk");
  });

  it("duplicates the work as To do, unassigned and undated, keeping subtasks and dependencies", async () => {
    const p = await project();
    const parent = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "Design",
      status: "done",
      assigneeMemberId: EDITOR,
      dueDate: "2026-10-20",
    });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Sketch", parentId: parent.id });
    const build = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Build" });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: build.id, blockedBy: [parent.id] });
    await setMilestonesOp.run(as(EDITOR, "editor"), { id: p.id, milestones: [{ name: "Beta", date: "2026-11-01" }] });

    const copy = await duplicateProjectOp.run(as(EDITOR, "editor"), { id: p.id });
    const ws = await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: copy.id });
    expect(copy.name).toBe("Website copy");
    expect(ws.tasks).toHaveLength(3);
    expect(ws.tasks.every((t) => t.status === "to_do" && !t.assigneeMemberId && !t.dueDate)).toBe(true);
    expect(ws.tasks.filter((t) => t.parentId)).toHaveLength(1);
    expect(ws.dependencies).toHaveLength(1);
    expect(ws.milestones.map((m) => m.name)).toEqual(["Beta"]);
  });

  it("deleting a Project deletes its Tasks", async () => {
    const p = await project();
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "One" });
    expect(await deleteProjectOp.run(as(EDITOR, "editor"), { id: p.id })).toEqual({ tasks: 1 });
    expect((await allTasksOp.run(as(EDITOR, "editor"), {})).tasks).toEqual([]);
  });
});

describe("Tasks", () => {
  it("numbers Tasks per Project and orders new ones last", async () => {
    const p = await project();
    const a = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "A" });
    const b = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "B" });
    const c = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "C",
      position: { afterId: a.id, beforeId: b.id },
    });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    const ws = await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id });
    expect(ws.tasks.map((t) => t.title)).toEqual(["A", "C", "B"]);
  });

  it("refuses a Viewer as an assignee", async () => {
    const p = await project();
    await expect(
      createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x", assigneeMemberId: VIEWER })
    ).rejects.toThrow(/Viewer/);
  });

  it("stamps completion with the status and clears it on reopen", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x" });
    const done = await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "done" } });
    expect(done.completedAt).not.toBeNull();
    const reopened = await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "to_do" } });
    expect(reopened.completedAt).toBeNull();
  });

  it("pulls the start back when the due date moves before it", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "x",
      startDate: "2026-10-10",
      dueDate: "2026-10-20",
    });
    const moved = await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { dueDate: "2026-10-05" } });
    expect(moved).toMatchObject({ startDate: "2026-10-05", dueDate: "2026-10-05" });
  });

  it("refuses a dependency loop and one across Projects", async () => {
    const p = await project();
    const other = await project({ name: "Other", description: "" });
    const a = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "A" });
    const b = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "B" });
    const c = await createTaskOp.run(as(EDITOR, "editor"), { projectId: other.id, title: "C" });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: a.id, blockedBy: [b.id] });
    await expect(updateTaskOp.run(as(EDITOR, "editor"), { id: b.id, blockedBy: [a.id] })).rejects.toThrow(/loop/);
    await expect(updateTaskOp.run(as(EDITOR, "editor"), { id: a.id, blockedBy: [c.id] })).rejects.toThrow(/its Project/);
  });

  it("keeps subtasks one level deep", async () => {
    const p = await project();
    const parent = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Parent" });
    const child = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Child", parentId: parent.id });
    await expect(
      createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Grandchild", parentId: child.id })
    ).rejects.toThrow(/top-level/);
    const detail = await getTaskOp.run(as(EDITOR, "editor"), { id: parent.id });
    expect(detail.subtasks.map((s) => s.title)).toEqual(["Child"]);
  });

  it("moves a Task with its subtasks to another Project, re-numbered and without dependencies", async () => {
    const from = await project({ name: "From", description: "" });
    const to = await project({ name: "To", description: "" });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: to.id, title: "Existing" });
    const blocker = await createTaskOp.run(as(EDITOR, "editor"), { projectId: from.id, title: "Blocker" });
    const task = await createTaskOp.run(as(EDITOR, "editor"), { projectId: from.id, title: "Mover" });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: from.id, title: "Sub", parentId: task.id });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: task.id, blockedBy: [blocker.id] });
    const moved = await updateTaskOp.run(as(EDITOR, "editor"), { id: task.id, projectId: to.id });
    expect(moved.projectId).toBe(to.id);
    // The parent moves first (the same-Project trigger checks each subtask
    // against it), so it takes the next key and its subtask the one after.
    expect(moved.seq).toBe(2);
    const ws = await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: to.id });
    expect(ws.tasks.map((t) => t.title).sort()).toEqual(["Existing", "Mover", "Sub"]);
    expect(ws.tasks.find((t) => t.title === "Sub")?.seq).toBe(3);
    expect(ws.dependencies).toEqual([]);
  });

  it("creates the next copy of a recurring Task once, when it is completed", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "Weekly report",
      recurrence: "weekly",
      dueDate: "2026-10-09",
    });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Gather numbers", parentId: t.id });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "done" } });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "to_do" } });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "done" } });
    const ws = await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id });
    const copies = ws.tasks.filter((x) => x.title === "Weekly report" && x.id !== t.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ status: "to_do", dueDate: "2026-10-16", recurrence: "weekly" });
    expect(ws.tasks.filter((x) => x.parentId === copies[0]!.id).map((x) => x.status)).toEqual(["to_do"]);
  });

  it("moves an Improvement to In Review when every Task that resolves it is done", async () => {
    const db = getMockDb();
    const p = await project();
    const filed = await db.createImprovement(DEMO_ORG.id, { title: "Wrong opening hours" });
    const improvement = await db.updateImprovement(filed.id, { status: "in_progress" });
    const a = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Fix FAQ", improvementId: improvement.id });
    const b = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Recrawl", improvementId: improvement.id });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: a.id, patch: { status: "done" } });
    expect((await db.getImprovement(improvement.id))?.status).toBe("in_progress");
    await updateTaskOp.run(as(EDITOR, "editor"), { id: b.id, patch: { status: "done" } });
    expect((await db.getImprovement(improvement.id))?.status).toBe("in_review");
    await updateTaskOp.run(as(EDITOR, "editor"), { id: b.id, patch: { status: "to_do" } });
    expect((await db.getImprovement(improvement.id))?.status).toBe("in_review");
  });

  it("undoes a recurring completion: the scheduled copy goes and the recurrence comes back (#1074)", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "Weekly report",
      recurrence: "weekly",
      dueDate: "2026-10-09",
    });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "in_progress" } });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "done" } });
    const undone = await undoCompleteTaskOp.run(as(EDITOR, "editor"), { id: t.id, status: "in_progress" });
    expect(undone).toMatchObject({ status: "in_progress", recurrence: "weekly", completedAt: null });
    const ws = await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id });
    expect(ws.tasks.filter((x) => x.title === "Weekly report")).toHaveLength(1);
    // Completing it again schedules exactly one copy, as the first time did.
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "done" } });
    const again = await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id });
    expect(again.tasks.filter((x) => x.title === "Weekly report")).toHaveLength(2);
  });

  it("keeps a scheduled copy someone already started when the completion is undone", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "Standup notes",
      recurrence: "daily",
      dueDate: "2026-10-09",
    });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { status: "done" } });
    const copy = (await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id })).tasks.find(
      (x) => x.title === "Standup notes" && x.id !== t.id
    )!;
    await updateTaskOp.run(as(EDITOR, "editor"), { id: copy.id, patch: { status: "in_progress" } });
    const undone = await undoCompleteTaskOp.run(as(EDITOR, "editor"), { id: t.id, status: "to_do" });
    expect(undone).toMatchObject({ status: "to_do", recurrence: null });
    expect(await getTaskOp.run(as(EDITOR, "editor"), { id: copy.id })).toBeTruthy();
  });

  it("settles the Improvement through the system port and records it on the Task (ADR-0027)", async () => {
    const db = getMockDb();
    const p = await project();
    const filed = await db.createImprovement(DEMO_ORG.id, { title: "Wrong opening hours" });
    const moved: string[] = [];
    const activity: WorkActivityEntry[] = [];
    const editor = ctx({
      userId: EDITOR,
      role: "editor",
      ports: {
        improvementSettlement: {
          read: async (id) => {
            const improvement = await db.getImprovement(id);
            return improvement ? { improvement, linkedTasks: await db.table("tasks").list({ improvementId: id }) } : null;
          },
          setStatus: async (id, status) => {
            moved.push(`${id}:${status}`);
            await db.updateImprovement(id, { status });
          },
        },
        workLog: { recordActivity: async (rows) => void activity.push(...rows), notify: async () => undefined },
      },
    });
    const t = await createTaskOp.run(editor, { projectId: p.id, title: "Fix FAQ", improvementId: filed.id });
    await updateTaskOp.run(editor, { id: t.id, patch: { status: "done" } });
    expect(moved).toEqual([`${filed.id}:in_review`]);
    const entry = activity.find((row) => row.verb === "improvement.review");
    expect(entry).toMatchObject({ taskId: t.id, data: { improvementKey: `IMP-${filed.seq}`, from: "to_do", to: "in_review" } });
  });

  it("lists Tasks by Label, due range, text and Improvement, a page at a time", async () => {
    const db = getMockDb();
    const p = await project();
    const label = await createTaskLabelOp.run(as(EDITOR, "editor"), { name: "Bug", color: "red" });
    const filed = await db.createImprovement(DEMO_ORG.id, { title: "Broken link" });
    const a = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Fix the footer", labelIds: [label.id], dueDate: "2026-11-02" });
    const b = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Write the brief", dueDate: "2026-12-01", improvementId: filed.id });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Undated" });
    const ids = async (input: Parameters<typeof listTasksOp.run>[1]) =>
      (await listTasksOp.run(as(VIEWER, "viewer"), input)).items.map((t) => t.id);
    expect(await ids({ projectId: p.id, labelId: label.id })).toEqual([a.id]);
    expect(await ids({ projectId: p.id, dueFrom: "2026-11-01", dueTo: "2026-11-30" })).toEqual([a.id]);
    expect(await ids({ projectId: p.id, q: "BRIEF" })).toEqual([b.id]);
    expect(await ids({ projectId: p.id, improvementId: filed.id })).toEqual([b.id]);
    const first = await listTasksOp.run(as(VIEWER, "viewer"), { projectId: p.id, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listTasksOp.run(as(VIEWER, "viewer"), { projectId: p.id, limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((t) => t.id)).size).toBe(3);
    await expect(listTasksOp.run(as(VIEWER, "viewer"), { projectId: p.id, cursor: "not-ours" })).rejects.toThrow(/cursor/);
  });

  it("archives and restores through an update, the way the API sends it", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Old" });
    expect((await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, archived: true })).archivedAt).not.toBeNull();
    const restored = await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, archived: false, patch: { title: "Back" } });
    expect(restored).toMatchObject({ archivedAt: null, title: "Back" });
  });

  it("refuses a Teammate assignee rather than dropping it (#1051)", () => {
    // The schema every surface parses before `run`: a field it stripped would
    // have created the Task without saying so.
    const forTeammate = { projectId: "p", title: "For a colleague", assigneeTeammateId: "tm-1" };
    expect(() => createTaskOp.input.parse(forTeammate)).toThrow(/Teammate cannot be assigned/);
    expect(() => updateTaskOp.input.parse({ id: "t", patch: { assigneeTeammateId: "tm-1" } })).toThrow(/Teammate/);
    expect(createTaskOp.input.parse({ projectId: "p", title: "x", assigneeTeammateId: null })).toBeTruthy();
  });

  it("archives a subtree and restores exactly it", async () => {
    const p = await project();
    const parent = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Parent" });
    const kept = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Kept", parentId: parent.id });
    const solo = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Solo", parentId: parent.id });
    await archiveTaskOp.run(as(EDITOR, "editor"), { id: solo.id, archived: true });
    await archiveTaskOp.run(as(EDITOR, "editor"), { id: parent.id, archived: true });
    expect((await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id })).tasks).toEqual([]);
    await archiveTaskOp.run(as(EDITOR, "editor"), { id: parent.id, archived: false });
    const titles = (await projectWorkspaceOp.run(as(EDITOR, "editor"), { id: p.id })).tasks.map((t) => t.title);
    expect(titles.sort()).toEqual(["Kept", "Parent"]);
    expect(kept.id).toBeTruthy();
  });

  it("deletes a Task with its subtasks", async () => {
    const p = await project();
    const parent = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Parent" });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Child", parentId: parent.id });
    expect(await deleteTaskOp.run(as(EDITOR, "editor"), { id: parent.id })).toEqual({ deleted: 2, improvementId: null });
  });

  it("replaces labels and lists Tasks in My Tasks for their assignee", async () => {
    const p = await project();
    const bug = await createTaskLabelOp.run(as(EDITOR, "editor"), { name: "Bug", color: "red" });
    const t = await createTaskOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      title: "Login fails",
      assigneeMemberId: OTHER_EDITOR,
      labelIds: [bug.id],
    });
    const mine = await myTasksOp.run(as(OTHER_EDITOR, "editor"), {});
    expect(mine.tasks.map((x) => x.id)).toEqual([t.id]);
    expect(mine.labelLinks.map((l) => l.labelId)).toEqual([bug.id]);
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, labelIds: [] });
    expect((await getTaskOp.run(as(EDITOR, "editor"), { id: t.id })).labelIds).toEqual([]);
  });
});

describe("collaboration", () => {
  it("lets a Viewer comment, mention and react, and keeps edits to the author", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x", assigneeMemberId: EDITOR });
    const comment = await createTaskCommentOp.run(as(VIEWER, "viewer"), {
      taskId: t.id,
      body: `Can ${mentionToken("Valeria", OTHER_EDITOR)} look?`,
    });
    expect(comment.mentions).toEqual([OTHER_EDITOR]);
    await expect(updateTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id, body: "hijack" })).rejects.toThrow(
      /author/
    );
    await reactToTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id, emoji: "👍", on: true });
    const { taskId, reactions } = await reactToTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id, emoji: "🎉", on: true });
    expect(taskId).toBe(t.id);
    expect(reactions).toHaveLength(2);
    const listed = await listTaskCommentsOp.run(as(EDITOR, "editor"), { taskId: t.id });
    expect(listed[0]!.reactions).toHaveLength(2);
  });

  it("reads a comment's excerpt from the comment, so an edit shows and a delete drops out (#1055)", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x" });
    const comment = await createTaskCommentOp.run(as(EDITOR, "editor"), { taskId: t.id, body: "first words" });
    const excerpts = async () =>
      (await workActivityOp.run(as(EDITOR, "editor"), { taskId: t.id }))
        .filter((entry) => entry.verb === "comment.added")
        .map((entry) => entry.data.excerpt);
    expect(await excerpts()).toEqual(["first words"]);
    await updateTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id, body: "second words" });
    expect(await excerpts()).toEqual(["second words"]);
    await deleteTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id });
    expect(await excerpts()).toEqual([]);
    const stored = await getMockDb().table("workActivity").list({ taskId: t.id });
    expect(stored.some((entry) => "excerpt" in entry.data)).toBe(false);
  });

  it("deletes a comment softly and brings it back with Undo", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x" });
    const comment = await createTaskCommentOp.run(as(EDITOR, "editor"), { taskId: t.id, body: "oops" });
    await deleteTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id });
    expect(await listTaskCommentsOp.run(as(EDITOR, "editor"), { taskId: t.id })).toEqual([]);
    await restoreTaskCommentOp.run(as(EDITOR, "editor"), { id: comment.id });
    expect(await listTaskCommentsOp.run(as(EDITOR, "editor"), { taskId: t.id })).toHaveLength(1);
  });

  it("notifies each recipient once, never the actor, and records who did it", async () => {
    const activity: WorkActivityEntry[] = [];
    const sent: WorkNotificationRow[] = [];
    const ported = (userId: string, role: OperationContext["role"]) =>
      ctx({
        userId,
        role,
        ports: {
          workLog: {
            recordActivity: async (rows) => void activity.push(...rows),
            notify: async (rows) => void sent.push(...rows),
          },
        },
      });
    const p = await project();
    const t = await createTaskOp.run(ported(EDITOR, "editor"), {
      projectId: p.id,
      title: "x",
      assigneeMemberId: OTHER_EDITOR,
    });
    expect(sent.map((n) => [n.recipientId, n.kind])).toEqual([[OTHER_EDITOR, "assigned"]]);
    sent.length = 0;
    await createTaskCommentOp.run(ported(OTHER_EDITOR, "editor"), {
      taskId: t.id,
      body: `Done, ${mentionToken("Martina", EDITOR)}`,
    });
    // The creator is mentioned, so they hear it once, as a mention.
    expect(sent.map((n) => [n.recipientId, n.kind])).toEqual([[EDITOR, "mentioned"]]);
    expect(activity.map((a) => a.verb)).toEqual(["task.created", "comment.added"]);
    expect(activity.every((a) => a.actorMemberId)).toBe(true);
  });

  it("marks notifications read for their recipient only", async () => {
    const p = await project();
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "x", assigneeMemberId: OTHER_EDITOR });
    const mine = await listMemberNotificationsOp.run(as(OTHER_EDITOR, "editor"), {});
    expect(mine).toHaveLength(1);
    expect(await listMemberNotificationsOp.run(as(EDITOR, "editor"), {})).toEqual([]);
    expect(await markNotificationsOp.run(as(OTHER_EDITOR, "editor"), { all: true, read: true })).toBe(1);
    expect(await listMemberNotificationsOp.run(as(OTHER_EDITOR, "editor"), { unreadOnly: true })).toEqual([]);
  });

  it("archives, snoozes and deletes a notification for its recipient only", async () => {
    const p = await project();
    for (const title of ["a", "b", "c"]) {
      await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title, assigneeMemberId: OTHER_EDITOR });
    }
    const me = as(OTHER_EDITOR, "editor");
    const [a, b, c] = (await notificationTriageOp.run(me, {})).map((n) => n.id);
    expect(await countUnreadNotificationsOp.run(me, {})).toBe(3);

    // Somebody else's ids change nothing.
    expect(await archiveNotificationsOp.run(as(EDITOR, "editor"), { ids: [a!], archived: true })).toBe(0);
    expect(await deleteNotificationsOp.run(as(EDITOR, "editor"), { ids: [a!] })).toBe(0);

    expect(await archiveNotificationsOp.run(me, { ids: [a!], archived: true })).toBe(1);
    expect(await snoozeNotificationsOp.run(me, { ids: [b!], until: new Date(Date.now() + 3_600_000).toISOString() })).toBe(1);
    expect(await deleteNotificationsOp.run(me, { ids: [c!] })).toBe(1);
    // Put away is out of the list and out of the badge.
    expect(await notificationTriageOp.run(me, {})).toEqual([]);
    expect(await countUnreadNotificationsOp.run(me, {})).toBe(0);

    // Undo brings the archived one back; a snooze that has passed brings itself back.
    await archiveNotificationsOp.run(me, { ids: [a!], archived: false });
    await snoozeNotificationsOp.run(me, { ids: [b!], until: new Date(Date.now() - 1000).toISOString() });
    expect((await notificationTriageOp.run(me, {})).map((n) => n.id).sort()).toEqual([a!, b!].sort());
    expect(await countUnreadNotificationsOp.run(me, {})).toBe(2);
  });

  it("leaves a notification out of the badge once its Project can no longer be read", async () => {
    const secret = await project({ name: "Secret", description: "", visibility: "private" });
    await setProjectMembersOp.run(as(EDITOR, "editor"), { id: secret.id, userIds: [EDITOR, OTHER_EDITOR] });
    await createTaskOp.run(as(EDITOR, "editor"), { projectId: secret.id, title: "x", assigneeMemberId: OTHER_EDITOR });
    const me = as(OTHER_EDITOR, "editor");
    expect(await countUnreadNotificationsOp.run(me, {})).toBe(1);
    await setProjectMembersOp.run(as(EDITOR, "editor"), { id: secret.id, userIds: [EDITOR] });
    // The page drops the row, so the badge must too, or it shows a number nothing clears.
    expect(await notificationTriageOp.run(me, {})).toEqual([]);
    expect(await countUnreadNotificationsOp.run(me, {})).toBe(0);
  });

  it("joins each notification's Task, Project and comment at read time", async () => {
    const p = await project();
    const t = await createTaskOp.run(as(EDITOR, "editor"), { projectId: p.id, title: "Old title", assigneeMemberId: OTHER_EDITOR });
    await createTaskCommentOp.run(as(EDITOR, "editor"), { taskId: t.id, body: `See ${mentionToken("Bo", OTHER_EDITOR)}` });
    await updateTaskOp.run(as(EDITOR, "editor"), { id: t.id, patch: { title: "New title" } });
    const inbox = await notificationTriageOp.run(as(OTHER_EDITOR, "editor"), {});
    expect(inbox.map((n) => [n.kind, n.task.title, n.project.key, n.excerpt]).sort()).toEqual([
      ["assigned", "New title", p.key, null],
      ["mentioned", "New title", p.key, "See @Bo"],
    ]);
    await markNotificationsOp.run(as(OTHER_EDITOR, "editor"), { ids: [inbox[0]!.id], read: true });
    expect(await notificationTriageOp.run(as(OTHER_EDITOR, "editor"), { unreadOnly: true })).toHaveLength(1);
  });

  it("keeps a Saved View's removal to its creator or an Admin, and stars per Member", async () => {
    const p = await project();
    const view = await createSavedViewOp.run(as(EDITOR, "editor"), {
      projectId: p.id,
      name: "Urgent",
      layout: "list",
      query: { filters: [{ field: "priority", op: "is", values: ["urgent"] }] },
    });
    expect(view.query.filters).toHaveLength(1);
    await expect(deleteSavedViewOp.run(as(OTHER_EDITOR, "editor"), { id: view.id })).rejects.toThrow(/Admin/);
    await deleteSavedViewOp.run(as(ADMIN, "admin"), { id: view.id });
    await setFavoriteOp.run(as(EDITOR, "editor"), { projectId: p.id, on: true });
    expect((await workDirectoryOp.run(as(EDITOR, "editor"), {})).favorites).toHaveLength(1);
    expect((await workDirectoryOp.run(as(OTHER_EDITOR, "editor"), {})).favorites).toHaveLength(0);
  });
});

describe("Project files (#1068)", () => {
  const withFiles = (userId: string, role: OperationContext["role"], removed: string[][]) =>
    ctx({ userId, role, ports: { workFiles: { remove: async (paths) => void removed.push(paths) } } });

  async function upload(c: OperationContext, projectId: string, name: string, taskId?: string) {
    const ticket = await prepareProjectFileOp.run(c, { projectId, taskId, name, sizeBytes: 2048 });
    return createProjectFileOp.run(c, { id: ticket.id, projectId, taskId, name, storagePath: ticket.storagePath, sizeBytes: 2048 });
  }

  it("decides the key and the type, and refuses a Viewer, an empty file and an oversized one", async () => {
    const p = await project();
    const ticket = await prepareProjectFileOp.run(as(EDITOR, "editor"), { projectId: p.id, name: "../brief.html", sizeBytes: 10 });
    expect(ticket.storagePath).toBe(`org/${DEMO_ORG.id}/projects/${p.id}/${ticket.id}/..brief.html`);
    expect(ticket.contentType).toBe("application/octet-stream");
    await expect(prepareProjectFileOp.run(as(VIEWER, "viewer"), { projectId: p.id, name: "a.pdf", sizeBytes: 10 })).rejects.toThrow();
    await expect(prepareProjectFileOp.run(as(EDITOR, "editor"), { projectId: p.id, name: "a.pdf", sizeBytes: 0 })).rejects.toThrow(/empty/);
    await expect(
      prepareProjectFileOp.run(as(EDITOR, "editor"), { projectId: p.id, name: "a.pdf", sizeBytes: 51 * 1024 * 1024 })
    ).rejects.toThrow(/50 MB/);
  });

  it("discards only the stray of a refused upload, never a recorded file", async () => {
    const removed: string[][] = [];
    const editor = withFiles(EDITOR, "editor", removed);
    const p = await project();
    const kept = await upload(editor, p.id, "kept.pdf");
    // A forged name cannot reach the recorded object: the key is recomputed.
    expect(await discardProjectFileUploadOp.run(editor, { id: kept.storagePath.split("/")[4]!, projectId: p.id, name: "kept.pdf" })).toEqual({
      removed: false,
    });
    const stray = await prepareProjectFileOp.run(editor, { projectId: p.id, name: "stray.pdf", sizeBytes: 10 });
    expect(await discardProjectFileUploadOp.run(editor, { id: stray.id, projectId: p.id, name: "stray.pdf" })).toEqual({
      removed: true,
    });
    expect(removed).toEqual([[stray.storagePath]]);
    await expect(
      discardProjectFileUploadOp.run(withFiles(VIEWER, "viewer", removed), { id: stray.id, projectId: p.id, name: "stray.pdf" })
    ).rejects.toThrow();
  });

  it("records only a key it issued", async () => {
    const p = await project();
    const ticket = await prepareProjectFileOp.run(as(EDITOR, "editor"), { projectId: p.id, name: "plan.pdf", sizeBytes: 10 });
    await expect(
      createProjectFileOp.run(as(EDITOR, "editor"), {
        id: ticket.id,
        projectId: p.id,
        name: "plan.pdf",
        storagePath: `org/other-org/projects/${p.id}/${ticket.id}/plan.pdf`,
        sizeBytes: 10,
      })
    ).rejects.toThrow(/not issued/);
  });

  it("lists an attachment once, and removes the objects with the file, the Task or the Project", async () => {
    const removed: string[][] = [];
    const editor = withFiles(EDITOR, "editor", removed);
    const p = await project();
    const t = await createTaskOp.run(editor, { projectId: p.id, title: "Launch" });
    const attached = await upload(editor, p.id, "brief.pdf", t.id);
    const loose = await upload(editor, p.id, "logo.png");
    expect(loose.contentType).toBe("image/png");
    const all = await listProjectFilesOp.run(as(VIEWER, "viewer"), { projectId: p.id });
    expect(all.map((f) => f.name).sort()).toEqual(["brief.pdf", "logo.png"]);
    expect(await listProjectFilesOp.run(as(VIEWER, "viewer"), { projectId: p.id, taskId: t.id })).toHaveLength(1);

    const renamed = await renameProjectFileOp.run(editor, { id: loose.id, name: "Logo final.png" });
    expect(renamed.name).toBe("Logo final.png");
    expect(renamed.storagePath).toBe(loose.storagePath);

    await deleteTaskOp.run(editor, { id: t.id });
    expect(removed).toEqual([[attached.storagePath]]);
    expect(await listProjectFilesOp.run(editor, { projectId: p.id })).toHaveLength(1);

    await deleteProjectOp.run(editor, { id: p.id });
    expect(removed).toEqual([[attached.storagePath], [loose.storagePath]]);
  });
});
