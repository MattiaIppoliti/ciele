"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChartGantt,
  CircleCheckBig,
  FlaskConical,
  List,
  ListChecks,
  Plus,
  SquareKanban,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button } from "@agent-hub/ui";
import type { ProjectFile, ProjectMilestone, SavedView, Task, TaskDependency, TaskLabelLink, WorkLayout, WorkViewQuery } from "@agent-hub/core";
import { isOverdue } from "@agent-hub/core";
import type { AssignedImprovement, ProjectWorkspace } from "@ciele/ops";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { SectionHeading } from "@/components/ui/section-heading";
import { IMPROVEMENT_STATUSES } from "@/lib/improvements";
import { weekStart } from "@/lib/work/work-calendar";
import { StarredChip } from "./work-toolbar";
import { IMPROVEMENT_STATUS_TONE, dueLabel } from "@/lib/work/work-format";
import { NewTaskDialog } from "./new-task-dialog";
import { SaveViewButton, SavedViewMenu } from "./saved-view-controls";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectFrame } from "./project-page";
import { ProjectOverview } from "./project-overview";
import { WorkActivityList } from "./work-activity-list";
import { ProjectFilesView } from "./project-files";
import { TaskDrawer } from "./task-drawer";
import { TaskListView, type TaskViewLayout } from "./task-list-view";
import { useOpenTask } from "./use-work-view";
import { useCreateShortcut } from "./use-create-shortcut";
import { useWorkDirectory } from "./work-directory";
import { Segmented } from "./work-ui";

/**
 * The work pages' client roots (#1063): one per route, each a thin assembly of
 * the shared view pieces.
 */

/** The toolbar's committing action, at its right end. */
function NewTaskButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick} className="h-7">
      <Plus className="size-3.5" /> New task
    </Button>
  );
}

/** A page title above the toolbar, on the views' gutter. */
function WorkPageHeader({ icon, title, description }: { icon: LucideIcon; title: string; description?: ReactNode }) {
  return (
    <header className="shrink-0 px-6 pt-5 pb-3">
      <SectionHeading icon={icon} title={title} description={description} />
    </header>
  );
}

export function ProjectView({
  view,
  savedView,
  workspace,
  files = [],
  defaults,
  initialQuery,
  initialTaskId,
}: {
  view: "overview" | "activity" | "files" | TaskViewLayout;
  /** The Files view's list (#1068). */
  files?: ProjectFile[];
  /** On a Saved View's tab: the view whose query and layout the page opened with. */
  savedView?: SavedView;
  workspace: ProjectWorkspace;
  defaults: WorkViewQuery;
  initialQuery: WorkViewQuery;
  initialTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const { project } = workspace;
  const viewerRole = dir.person(dir.viewerId)?.role;
  // Its creator or an Admin manages a Saved View (#1050).
  const canManageView = (v: SavedView) =>
    dir.canEdit && (v.createdBy === dir.viewerId || viewerRole === "admin" || viewerRole === "owner");
  useCreateShortcut("task", dir.canEdit && !project.archived ? () => setCreating(true) : null);
  return (
    <ProjectFrame
      project={project}
      memberIds={workspace.memberIds}
      savedViews={workspace.savedViews}
      onNewTask={view === "overview" || view === "activity" || view === "files" ? () => setCreating(true) : undefined}
    >
      {view === "overview" ? (
        <OverviewWithDrawer workspace={workspace} initialTaskId={initialTaskId} onEdit={() => setEditing(true)} />
      ) : view === "activity" ? (
        <ActivityWithDrawer workspace={workspace} initialTaskId={initialTaskId} />
      ) : view === "files" ? (
        <FilesWithDrawer workspace={workspace} files={files} initialTaskId={initialTaskId} />
      ) : (
        <div className="h-full min-h-0">
          <TaskListView
            scope="project"
            layout={view}
            tasks={workspace.tasks}
            labelLinks={workspace.labelLinks}
            dependencies={workspace.dependencies}
            milestones={workspace.milestones}
            defaults={defaults}
            initialQuery={initialQuery}
            initialTaskId={initialTaskId}
            projectId={project.id}
            projectMemberIds={project.visibility === "private" ? workspace.memberIds : null}
            newTask={dir.canEdit && !project.archived ? <NewTaskButton onClick={() => setCreating(true)} /> : null}
            toolbarExtra={(query) =>
              savedView ? (
                <SavedViewMenu view={savedView} query={query} canManage={canManageView(savedView)} />
              ) : isSavable(view) ? (
                <SaveViewButton projectId={project.id} query={query} layout={view} />
              ) : null
            }
          />
        </div>
      )}
      {creating && <NewTaskDialog open={creating} onClose={() => setCreating(false)} projectId={project.id} />}
      {editing && <ProjectFormDialog open={editing} onClose={() => setEditing(false)} project={project} />}
    </ProjectFrame>
  );
}

function OverviewWithDrawer({
  workspace,
  initialTaskId,
  onEdit,
}: {
  workspace: ProjectWorkspace;
  initialTaskId: string | null;
  onEdit: () => void;
}) {
  const { openTaskId, openTask } = useOpenTask(initialTaskId);
  return (
    <TaskDrawer openTaskId={openTaskId} onOpenTask={openTask} projectTasks={workspace.tasks}>
      <div className="h-full overflow-y-auto px-6 py-5">
        <ProjectOverview workspace={workspace} onOpenTask={openTask} onEdit={onEdit} />
      </div>
    </TaskDrawer>
  );
}

/** The Project's Activity view (#1066): every entry, by day; a line opens its Task in the drawer. */
function ActivityWithDrawer({ workspace, initialTaskId }: { workspace: ProjectWorkspace; initialTaskId: string | null }) {
  const { openTaskId, openTask } = useOpenTask(initialTaskId);
  return (
    <TaskDrawer openTaskId={openTaskId} onOpenTask={openTask} projectTasks={workspace.tasks}>
      <div className="h-full overflow-y-auto px-6 py-5">
        <div className="max-w-3xl">
          <WorkActivityList entries={workspace.activity} withTask onOpenTask={openTask} />
        </div>
      </div>
    </TaskDrawer>
  );
}

/** The Project's Files view (#1068): a file's task badge opens its Task in the drawer. */
function FilesWithDrawer({
  workspace,
  files,
  initialTaskId,
}: {
  workspace: ProjectWorkspace;
  files: ProjectFile[];
  initialTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const { openTaskId, openTask } = useOpenTask(initialTaskId);
  return (
    <TaskDrawer openTaskId={openTaskId} onOpenTask={openTask} projectTasks={workspace.tasks}>
      <div className="@container h-full min-h-0">
        <ProjectFilesView
          projectId={workspace.project.id}
          files={files}
          tasks={workspace.tasks}
          editable={dir.canEdit && !workspace.project.archived}
          onOpenTask={openTask}
          // Every file action revalidates the Project's pages, so the list arrives refreshed.
          onChanged={() => {}}
        />
      </div>
    </TaskDrawer>
  );
}

export function MyTasksView({
  tasks,
  labelLinks,
  improvements,
  initialLayout = "list",
  defaults,
  initialQuery,
  initialTaskId,
}: {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  improvements: AssignedImprovement[];
  initialLayout?: "list" | "calendar";
  defaults: WorkViewQuery;
  initialQuery: WorkViewQuery;
  initialTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const [creating, setCreating] = useState(false);
  const [layout, setLayout] = useState(initialLayout);
  useCreateShortcut("task", dir.canEdit && dir.projects.length > 0 ? () => setCreating(true) : null);
  const open = tasks.filter((t) => t.status !== "done");
  const dueToday = open.filter((t) => t.dueDate === dir.today).length;
  const overdue = open.filter((t) => isOverdue(t, dir.today)).length;
  // This week is Monday to today (#1073), not the last seven days.
  const monday = weekStart(dir.today);
  const doneThisWeek = tasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= monday).length;
  const openImprovements = improvements.filter((i) => i.status !== "done");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkPageHeader
        icon={CircleCheckBig}
        title="My Tasks"
        description={
          <span aria-live="polite">
            {open.length} open · {dueToday} due today · <span className={overdue ? "text-destructive" : undefined}>{overdue} overdue</span> · {doneThisWeek} completed this week
          </span>
        }
      />
      <div className="min-h-0 flex-1">
        <TaskListView
          scope="my-tasks"
          layout={layout}
          tasks={tasks}
          labelLinks={labelLinks}
          defaults={defaults}
          initialQuery={initialQuery}
          initialTaskId={initialTaskId}
          newTask={dir.canEdit && dir.projects.length > 0 ? <NewTaskButton onClick={() => setCreating(true)} /> : null}
          toolbarExtra={(query, change) => (
            <>
              <StarredChip query={query} onChange={change} />
              <Segmented
                label="Layout"
                className="ml-1"
                value={layout}
                onChange={(next) => {
                  setLayout(next);
                  replaceLayoutUrl("/my-tasks", next === "calendar" ? { layout: "calendar" } : {});
                }}
                options={[
                  { value: "list", label: "List", icon: List },
                  { value: "calendar", label: "Calendar", icon: CalendarDays },
                ]}
              />
            </>
          )}
          header={
            openImprovements.length > 0 ? (
              <section aria-label="Improvements assigned to you" className="border-alpha-medium mx-6 mb-3 rounded-xl border px-3 py-2">
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">Improvements</p>
                <ul className="flex flex-col">
                  {openImprovements.map((item) => (
                    <li key={item.id}>
                      <Link href={`/improvements/${item.id}`} className="press hover:bg-alpha-light flex items-center gap-2 rounded-md px-1.5 py-1 text-sm">
                        <FlaskConical aria-hidden className="text-muted-foreground size-4" />
                        <span className="text-muted-foreground font-mono text-xs">IMP-{item.seq}</span>
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <Badge tone={IMPROVEMENT_STATUS_TONE[item.status]}>
                          {IMPROVEMENT_STATUSES.find((s) => s.value === item.status)?.label ?? item.status}
                        </Badge>
                        {item.dueDate && <span className="text-muted-foreground text-xs">{dueLabel(item.dueDate, dir.today).text}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null
          }
        />
      </div>
      {creating && (
        <NewTaskDialog open={creating} onClose={() => setCreating(false)} defaults={{ assigneeMemberId: dir.viewerId, dueDate: dir.today }} />
      )}
    </div>
  );
}

export function AllTasksView({
  tasks,
  labelLinks,
  dependencies,
  milestones,
  initialLayout,
  initialCreating = false,
  defaults,
  initialQuery,
  initialTaskId,
}: {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  dependencies: TaskDependency[];
  milestones: ProjectMilestone[];
  initialLayout: TaskViewLayout;
  /** `?new=task`: the shell's `N` landed here from a page that cannot create one. */
  initialCreating?: boolean;
  defaults: WorkViewQuery;
  initialQuery: WorkViewQuery;
  initialTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const [layout, setLayout] = useState<TaskViewLayout>(initialLayout);
  const [creating, setCreating] = useState(initialCreating && dir.canEdit && dir.projects.length > 0);
  useCreateShortcut("task", dir.canEdit && dir.projects.length > 0 ? () => setCreating(true) : null);
  const [creatingProject, setCreatingProject] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {dir.canEdit && dir.projects.length === 0 && (
        <SlotPortal id={TOP_BAR_SLOT}>
          <Button size="sm" onClick={() => setCreatingProject(true)}>
            <Plus className="size-4" /> New project
          </Button>
        </SlotPortal>
      )}
      <WorkPageHeader icon={ListChecks} title="All tasks" />
      <div className="min-h-0 flex-1">
        <TaskListView
          scope="all-tasks"
          layout={layout}
          tasks={tasks}
          labelLinks={labelLinks}
          dependencies={dependencies}
          milestones={milestones}
          defaults={defaults}
          initialQuery={initialQuery}
          initialTaskId={initialTaskId}
          newTask={dir.canEdit && dir.projects.length > 0 ? <NewTaskButton onClick={() => setCreating(true)} /> : null}
          toolbarExtra={() => (
            <LayoutSwitch
              value={layout}
              onChange={(next) => {
                setLayout(next);
                // Calendar and Timeline are their own addresses (#1065); the
                // other three ride on /tasks.
                if (next === "calendar" || next === "timeline") replaceLayoutUrl(`/tasks/${next}`, {});
                else replaceLayoutUrl("/tasks", next === "list" ? {} : { layout: next });
              }}
            />
          )}
        />
      </div>
      {creating && <NewTaskDialog open={creating} onClose={() => setCreating(false)} />}
      {creatingProject && <ProjectFormDialog open={creatingProject} onClose={() => setCreatingProject(false)} />}
    </div>
  );
}

/** The layouts a Saved View can keep (#1050); Calendar and Timeline are not among them. */
function isSavable(view: "overview" | "activity" | "files" | TaskViewLayout): view is WorkLayout {
  return view === "list" || view === "board" || view === "table";
}

/**
 * Records the layout in the address without a navigation, keeping the view's
 * other parameters, so a reload or a shared link opens the same layout.
 */
function replaceLayoutUrl(pathname: string, params: { layout?: string }) {
  const next = new URLSearchParams(window.location.search);
  next.delete("layout");
  if (params.layout) next.set("layout", params.layout);
  const query = next.toString();
  window.history.replaceState(window.history.state, "", `${pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

/** The Organization's task layouts (#1050, #1065). */
function LayoutSwitch({ value, onChange }: { value: TaskViewLayout; onChange: (layout: TaskViewLayout) => void }) {
  return (
    <Segmented
      label="Layout"
      className="ml-1"
      compact
      value={value}
      onChange={onChange}
      options={[
        { value: "list", label: "List", icon: List },
        { value: "board", label: "Board", icon: SquareKanban },
        { value: "table", label: "Table", icon: Table2 },
        { value: "calendar", label: "Calendar", icon: CalendarDays },
        { value: "timeline", label: "Timeline", icon: ChartGantt },
      ]}
    />
  );
}
