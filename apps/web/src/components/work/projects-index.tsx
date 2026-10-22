"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { FolderKanban, LayoutGrid, List, Lock, Plus, Search, Star } from "lucide-react";
import { Badge, Button, Card, Input } from "@agent-hub/ui";
import type { Project, ProjectStatus } from "@agent-hub/core";
import { PROJECT_STATUSES } from "@agent-hub/core";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE, dueLabel } from "@/lib/work/work-format";
import { setFavoriteAction } from "@/app/work-actions";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectGlyph } from "./work-icons";
import { useWorkDirectory } from "./work-directory";
import { useCreateShortcut } from "./use-create-shortcut";

/**
 * The Projects index (#1053): every Project the viewer can see, as cards or
 * rows, with search, a status filter and a sort. Progress is derived from the
 * Tasks on the server and passed in.
 */

type Sort = "name" | "due" | "progress" | "created";

export function ProjectsIndex({
  projects,
  archived,
  progress,
  initialCreating = false,
}: {
  projects: Project[];
  archived: Project[];
  progress: Record<string, { done: number; total: number; percent: number }>;
  /** `?new=project`: the shell's `P` landed here from another page. */
  initialCreating?: boolean;
}) {
  const dir = useWorkDirectory();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [sort, setSort] = useState<Sort>("name");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(initialCreating && dir.canEdit);
  useCreateShortcut("project", dir.canEdit ? () => setCreating(true) : null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (showArchived ? archived : projects)
      .filter((p) => status === "all" || p.status === status)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      .sort((a, b) => {
        switch (sort) {
          case "name":
            return a.name.localeCompare(b.name);
          case "due":
            return (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
          case "progress":
            return (progress[b.id]?.percent ?? 0) - (progress[a.id]?.percent ?? 0);
          case "created":
            return a.createdAt < b.createdAt ? 1 : -1;
        }
      });
  }, [projects, archived, showArchived, status, sort, query, progress]);

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-5 @md:px-6">
      {dir.canEdit && (
        <SlotPortal id={TOP_BAR_SLOT}>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New project
          </Button>
        </SlotPortal>
      )}
      <SectionHeading icon={FolderKanban} title="Projects" className="mb-4" />
      {projects.length === 0 && archived.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="No projects yet"
          description="A project holds a piece of work: its tasks, milestones and files."
        >
          {dir.canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New project
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <div className="relative w-full max-w-64 @md:w-56">
              <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="h-8 pl-8" />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus | "all")}>
              <SelectTrigger aria-label="Status" className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="Sort" className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="due">Target date</SelectItem>
                <SelectItem value="progress">Progress</SelectItem>
                <SelectItem value="created">Newest</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant={showArchived ? "secondary" : "ghost"} onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}>
              Archived ({archived.length})
            </Button>
            <div className="ml-auto flex rounded-lg" role="radiogroup" aria-label="Layout">
              {(
                [
                  ["grid", LayoutGrid, "Grid"],
                  ["list", List, "List"],
                ] as const
              ).map(([value, Icon, label]) => (
                <Button key={value} size="icon-sm" variant={layout === value ? "secondary" : "ghost"} role="radio" aria-checked={layout === value} aria-label={label} onClick={() => setLayout(value)}>
                  <Icon className="size-4" />
                </Button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            {shown.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">No project matches.</p>
            ) : layout === "grid" ? (
              <ul className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
                {shown.map((project, index) => (
                  <RollRow key={project.id} index={index}>
                    <li>
                      <ProjectCard project={project} progress={progress[project.id]} />
                    </li>
                  </RollRow>
                ))}
              </ul>
            ) : (
              <ul className="divide-alpha-medium border-alpha-medium divide-y overflow-hidden rounded-xl border">
                {shown.map((project, index) => (
                  <RollRow key={project.id} index={index}>
                    <li>
                      <ProjectRow project={project} progress={progress[project.id]} />
                    </li>
                  </RollRow>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {creating && <ProjectFormDialog open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function FavoriteToggle({ project }: { project: Project }) {
  const dir = useWorkDirectory();
  const [, startTransition] = useTransition();
  const on = dir.isFavorite({ projectId: project.id });
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-pressed={on}
      aria-label={on ? `Unstar ${project.name}` : `Star ${project.name}`}
      onClick={(event) => {
        event.preventDefault();
        startTransition(async () => void (await setFavoriteAction({ projectId: project.id }, !on)));
      }}
    >
      <Star className={cn("size-4", on && "fill-current")} />
    </Button>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <span className="bg-alpha-medium block h-1.5 overflow-hidden rounded-full" aria-hidden>
      <span className="bg-tone-green-ink block h-full rounded-full" style={{ width: `${percent}%` }} />
    </span>
  );
}

function ProjectCard({ project, progress }: { project: Project; progress?: { done: number; total: number; percent: number } }) {
  const dir = useWorkDirectory();
  const lead = dir.person(project.leadId);
  return (
    <Card size="sm" className="press relative h-full">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <span className="bg-alpha-light flex size-8 shrink-0 items-center justify-center rounded-lg">
            <ProjectGlyph icon={project.icon} color={project.color} />
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/projects/${project.id}/list`} className="flex items-center gap-1.5 font-semibold after:absolute after:inset-0">
              <span className="truncate">
                <RollInText text={project.name} />
              </span>
              {project.visibility === "private" && <Lock aria-label="Private" className="text-muted-foreground size-3.5 shrink-0" />}
            </Link>
            <span className="text-muted-foreground font-mono text-xs">{project.key}</span>
          </div>
          <span className="relative z-10">
            <FavoriteToggle project={project} />
          </span>
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-10 text-sm">{project.description || "No description."}</p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>{PROJECT_STATUS_LABELS[project.status]}</Badge>
            <span className="text-muted-foreground">
              <RollInText text={`${progress?.done ?? 0}/${progress?.total ?? 0} done`} />
            </span>
          </div>
          <ProgressBar percent={progress?.percent ?? 0} />
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {lead && <UserAvatar userId={lead.userId} email={lead.email} avatarUrl={lead.avatarUrl} size="size-5" />}
          {project.dueDate && <span>Target {dueLabel(project.dueDate, dir.today).text}</span>}
        </div>
      </div>
    </Card>
  );
}

function ProjectRow({ project, progress }: { project: Project; progress?: { done: number; total: number; percent: number } }) {
  const dir = useWorkDirectory();
  return (
    <div className="press hover:bg-alpha-lighter relative flex items-center gap-3 px-3 py-2">
      <ProjectGlyph icon={project.icon} color={project.color} />
      <Link href={`/projects/${project.id}/list`} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium after:absolute after:inset-0">
        <span className="truncate">
          <RollInText text={project.name} />
        </span>
        {project.visibility === "private" && <Lock aria-label="Private" className="text-muted-foreground size-3.5 shrink-0" />}
      </Link>
      <span className="text-muted-foreground hidden font-mono text-xs @md:inline">{project.key}</span>
      <Badge tone={PROJECT_STATUS_TONE[project.status]}>{PROJECT_STATUS_LABELS[project.status]}</Badge>
      <span className="hidden w-32 @lg:block">
        <ProgressBar percent={progress?.percent ?? 0} />
      </span>
      <span className="text-muted-foreground hidden w-20 text-right text-xs @lg:inline">
        {project.dueDate ? dueLabel(project.dueDate, dir.today).text : "—"}
      </span>
      <span className="relative z-10">
        <FavoriteToggle project={project} />
      </span>
    </div>
  );
}
