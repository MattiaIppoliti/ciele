"use client";

import Link from "next/link";
import { createElement, useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { usePathname, useRouter } from "next/navigation";
import { rememberProjectView } from "@/lib/work/project-view-preference";
import {
  Activity,
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChartGantt,
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  LayoutDashboard,
  List,
  ListFilter,
  Paperclip,
  Lock,
  Plus,
  Settings2,
  Share2,
  SquareKanban,
  Star,
  Table2,
  Trash2,
} from "lucide-react";
import { Badge, Button, Hint, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import type { Project, ProjectStatus, SavedView } from "@agent-hub/core";
import { PROJECT_STATUSES } from "@agent-hub/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHeading } from "@/components/ui/section-heading";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { PageCrumb } from "@/components/shell/top-bar-slots";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { DOT_CLASS, PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE } from "@/lib/work/work-format";
import {
  duplicateProjectAction,
  setFavoriteAction,
  updateWorkProjectAction,
} from "@/app/work-actions";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectShareDialog } from "./project-share-dialog";
import { DeleteProjectModal } from "./delete-project-modal";
import { ProjectGlyph, projectIcon } from "./work-icons";
import { useWorkDirectory } from "./work-directory";
import { AvatarStack } from "./work-ui";

/**
 * A Project's page frame (#1054): the header (icon, name, star, status,
 * people, Share, settings, the menu) and the views as underlined route tabs,
 * so the browser's back button walks views. The view itself is the child,
 * flush to the frame's edges.
 */

export const PROJECT_VIEWS = [
  { slug: "overview", label: "Overview", icon: LayoutDashboard },
  { slug: "board", label: "Board", icon: SquareKanban },
  { slug: "list", label: "List", icon: List },
  { slug: "table", label: "Table", icon: Table2 },
  { slug: "calendar", label: "Calendar", icon: CalendarDays },
  { slug: "timeline", label: "Timeline", icon: ChartGantt },
  { slug: "files", label: "Files", icon: Paperclip },
  { slug: "activity", label: "Activity", icon: Activity },
] as const;

export function ProjectFrame({
  project,
  memberIds,
  savedViews = [],
  onNewTask,
  children,
}: {
  project: Project;
  memberIds: string[];
  /** The Project's Saved Views, as extra tabs after the built-in ones. */
  savedViews?: SavedView[];
  /** The page's committing action, in the top bar, for a view with no toolbar of its own. */
  onNewTask?: () => void;
  children: ReactNode;
}) {
  const dir = useWorkDirectory();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useOptimistic(project.status);
  const [editing, setEditingState] = useState(false);
  const [sharing, setSharingState] = useState(false);
  const [openings, setOpenings] = useState({ edit: 0, share: 0 });
  const setEditing = (open: boolean) => {
    if (open) setOpenings((n) => ({ ...n, edit: n.edit + 1 }));
    setEditingState(open);
  };
  const setSharing = (open: boolean) => {
    if (open) setOpenings((n) => ({ ...n, share: n.share + 1 }));
    setSharingState(open);
  };
  const [deleting, setDeleting] = useState(false);
  const favorite = dir.isFavorite({ projectId: project.id });
  const lead = dir.person(project.leadId);
  const editable = dir.canEdit;
  const segments = pathname.split("/");
  const current = segments[3] === "views" ? `views/${segments[4]}` : (segments[3] ?? "list");
  // The view opened last is where `/projects/{id}` opens next time.
  useEffect(() => rememberProjectView(current), [current]);
  // The pill moves on the click; the route catches up and then owns it.
  const [tab, setTab] = useState(current);
  const [lastCurrent, setLastCurrent] = useState(current);
  if (current !== lastCurrent) {
    setLastCurrent(current);
    setTab(current);
  }

  const changeStatus = (next: ProjectStatus) =>
    startTransition(async () => {
      setStatus(next);
      const result = await updateWorkProjectAction({ id: project.id, patch: { status: next } });
      if (!result.ok) toast.error(result.error);
    });

  const archive = (archived: boolean) =>
    startTransition(async () => {
      const result = await updateWorkProjectAction({ id: project.id, patch: { archived } });
      if (!result.ok) return toast.error(result.error);
      if (!archived) return toast.success("Project restored");
      toast.undo("Project archived", () => updateWorkProjectAction({ id: project.id, patch: { archived: false } }));
    });

  const people = [lead, ...memberIds.map((id) => dir.person(id))].filter(
    (p, i, all): p is NonNullable<typeof p> => !!p && all.findIndex((q) => q?.userId === p.userId) === i
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageCrumb label={project.name} />
      {editable && onNewTask && !project.archived && (
        <SlotPortal id={TOP_BAR_SLOT}>
          <Button size="sm" onClick={onNewTask}>
            <Plus className="size-4" /> New task
          </Button>
        </SlotPortal>
      )}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 px-6 pt-5 pb-3">
        <SectionHeading icon={projectIcon(project.icon)} title={project.name} className="min-w-0" />
        {project.visibility === "private" && <Lock aria-label="Private" className="text-muted-foreground size-3.5 shrink-0" />}
        <Hint label={favorite ? "Remove from favorites" : "Add to favorites"}>
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => startTransition(async () => void (await setFavoriteAction({ projectId: project.id }, !favorite)))}
            className={cn(
              "press-control hover:bg-alpha-light grid size-7 place-items-center rounded-md",
              favorite ? "text-tone-amber-ink" : "text-muted-foreground"
            )}
          >
            <Star className={cn("size-4", favorite && "fill-current")} />
          </button>
        </Hint>
        <Popover>
          <PopoverTrigger
            disabled={!editable}
            render={
              <button
                type="button"
                className="press-control border-alpha-medium hover:bg-alpha-light data-[popup-open]:bg-alpha-light inline-flex h-6 items-center gap-1.5 rounded-full border pr-1.5 pl-2 text-xs font-medium disabled:hover:bg-transparent"
                aria-label={`Status: ${PROJECT_STATUS_LABELS[status]}`}
              />
            }
          >
            <i aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASS[PROJECT_STATUS_TONE[status]])} />
            {PROJECT_STATUS_LABELS[status]}
            {editable && <ChevronDown aria-hidden className="text-muted-foreground size-3" />}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-1">
            {PROJECT_STATUSES.map((s) => (
              <PopoverClose
                key={s}
                render={<button type="button" />}
                aria-pressed={status === s}
                onClick={() => changeStatus(s)}
                className="hover:bg-alpha-light flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
              >
                <i aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASS[PROJECT_STATUS_TONE[s]])} />
                {PROJECT_STATUS_LABELS[s]}
                {status === s && <Check aria-hidden className="ml-auto size-4" />}
              </PopoverClose>
            ))}
          </PopoverContent>
        </Popover>
        {project.archived && <Badge tone="gray">Archived</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {people.length > 0 && (
            <Hint label={lead ? `Lead: ${lead.name}` : `${people.length} people`}>
              <span className="mr-1 inline-flex" role="img" aria-label={`${people.length} people`}>
                <AvatarStack people={people} max={3} />
              </span>
            </Hint>
          )}
          {editable && (
            <Button size="sm" variant="secondary" onClick={() => setSharing(true)}>
              <Share2 className="size-4" /> Share
            </Button>
          )}
          {editable && (
            <Hint label="Project settings">
              <Button size="icon-sm" variant="ghost" aria-label="Project settings" onClick={() => setEditing(true)}>
                <Settings2 className="size-4" />
              </Button>
            </Hint>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More project actions" />}>
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}/projects/${project.id}`);
                  toast.success("Link copied");
                }}
              >
                <Copy className="size-4" /> Copy link
              </DropdownMenuItem>
              {editable && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      startTransition(async () => {
                        const result = await duplicateProjectAction(project.id);
                        if (!result.ok) return toast.error(result.error);
                        toast.success("Project duplicated");
                        router.push(`/projects/${result.value.id}/list`);
                      })
                    }
                  >
                    <Copy className="size-4" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => archive(!project.archived)}>
                    {project.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                    {project.archived ? "Restore" : "Archive"}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <nav aria-label="Project views" className="border-alpha-medium shrink-0 border-b px-4 py-1.5">
        {/* Link tabs: each view is its own route, so back walks views. */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Project views">
            {PROJECT_VIEWS.map((view) => (
              <TabsTrigger key={view.slug} value={view.slug} href={`/projects/${project.id}/${view.slug}`}>
                <span className="inline-flex items-center gap-1.5">
                  {createElement(view.icon, { "aria-hidden": true, className: "size-3.5" })}
                  {view.label}
                </span>
              </TabsTrigger>
            ))}
            {savedViews.map((view) => (
              <TabsTrigger key={view.id} value={`views/${view.id}`} href={`/projects/${project.id}/views/${view.id}`}>
                <span className="inline-flex items-center gap-1.5">
                  <ListFilter aria-hidden className="size-3.5" />
                  <span className="max-w-40 truncate">{view.name}</span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </nav>
      <div className="min-h-0 flex-1">{children}</div>
      {/* Mounted while closed so closing plays its exit; keyed per opening so
          each one starts from the Project as it is now. */}
      <ProjectFormDialog key={`edit-${openings.edit}`} open={editing} onClose={() => setEditing(false)} project={project} />
      <ProjectShareDialog key={`share-${openings.share}`} open={sharing} onClose={() => setSharing(false)} project={project} memberIds={memberIds} />
      <DeleteProjectModal
        project={project}
        open={deleting}
        onClose={() => setDeleting(false)}
        onArchive={() => archive(true)}
        onDeleted={() => router.push("/projects")}
      />
    </div>
  );
}

/** A link to a Project, for cards and lists. */
export function ProjectLink({ project, className }: { project: Project; className?: string }) {
  return (
    <Link href={`/projects/${project.id}/list`} className={cn("press-text inline-flex min-w-0 items-center gap-1.5", className)}>
      <ProjectGlyph icon={project.icon} color={project.color} />
      <span className="truncate">{project.name}</span>
    </Link>
  );
}
