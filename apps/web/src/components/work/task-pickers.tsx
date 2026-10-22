"use client";

import { SpringSpan } from "@/components/motion/layout-spring";
import { SwatchRadioGroup } from "./work-ui";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Check, Plus, Search } from "lucide-react";
import {
  Button,
  Calendar,
  Input,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import type { Task, TaskPriority, TaskRecurrence, TaskStatus, WorkColor } from "@agent-hub/core";
import {
  ESTIMATE_PRESETS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCES,
  TASK_RECURRENCE_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  WORK_COLORS,
  addDays,
  formatEstimate,
  parseEstimate,
} from "@agent-hub/core";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { createTaskLabelAction, listOpenImprovementsAction } from "@/app/work-actions";
import { matchesImprovement, type ResolvableImprovement } from "@/lib/work/improvement-tasks";
import { ColorDot, PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import { useWorkDirectory } from "./work-directory";

/**
 * The property pickers (#1054): one `Popover` each, the Improvement detail's
 * hand-rolled list shape with an `Input` filter where the list is long. The
 * caller passes the trigger, so the same picker serves the drawer's pill, a
 * list row's cell and the bulk bar. The list is the keyboard path for every
 * drag (WCAG 2.5.7).
 */

const ROW =
  "hover:bg-alpha-light focus-visible:bg-alpha-light flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none";

interface PickerProps {
  trigger: ReactElement;
  disabled?: boolean;
  align?: "start" | "center" | "end";
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative mb-1.5">
      <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        className="h-8 pl-8"
      />
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return <Check aria-hidden className={cn("ml-auto size-4", on ? "opacity-100" : "opacity-0")} />;
}

export function StatusPicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & { value: TaskStatus; onChange: (status: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent
        align={align}
        className="w-48 p-1"
        onKeyDown={(event) => {
          // 1-5: a number picks a status while the list is open.
          const index = Number(event.key) - 1;
          if (index >= 0 && index < TASK_STATUSES.length) {
            event.preventDefault();
            onChange(TASK_STATUSES[index]!);
            setOpen(false);
          }
        }}
      >
        {TASK_STATUSES.map((status, index) => (
          <PopoverClose key={status} render={<button type="button" />} className={ROW} onClick={() => onChange(status)} aria-pressed={value === status}>
            <TaskStatusIcon status={status} />
            {TASK_STATUS_LABELS[status]}
            <span className="text-muted-foreground ml-auto text-xs">{index + 1}</span>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function PriorityPicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & { value: TaskPriority; onChange: (priority: TaskPriority) => void }) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-48 p-1">
        {TASK_PRIORITIES.map((priority) => (
          <PopoverClose key={priority} render={<button type="button" />} className={ROW} onClick={() => onChange(priority)} aria-pressed={value === priority}>
            <PriorityIcon priority={priority} />
            {TASK_PRIORITY_LABELS[priority]}
            <Tick on={value === priority} />
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function AssigneePicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
  projectMemberIds,
}: PickerProps & {
  value: string | null;
  onChange: (assignee: string | null) => void;
  /** A private Project's members: only they can be assigned its work. */
  projectMemberIds?: readonly string[] | null;
}) {
  const { people, viewerId } = useWorkDirectory();
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => p.assignable)
      .filter((p) => !projectMemberIds || projectMemberIds.includes(p.userId) || p.role === "owner" || p.role === "admin")
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .sort((a, b) => (a.userId === viewerId ? -1 : b.userId === viewerId ? 1 : a.name.localeCompare(b.name)));
  }, [people, query, viewerId, projectMemberIds]);
  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-64 p-1.5">
        <SearchBox value={query} onChange={setQuery} label="Assign to…" />
        <div className="max-h-64 overflow-y-auto">
          <PopoverClose render={<button type="button" />} className={cn(ROW, "text-muted-foreground")} onClick={() => onChange(null)} aria-pressed={value === null}>
            <span className="border-alpha-strong size-5 rounded-full border border-dashed" aria-hidden />
            Unassigned
            <Tick on={value === null} />
          </PopoverClose>
          {candidates.map((person) => (
            <PopoverClose key={person.userId} render={<button type="button" />} className={ROW} onClick={() => onChange(person.userId)} aria-pressed={value === person.userId}>
              <UserAvatar userId={person.userId} email={person.email} avatarUrl={person.avatarUrl} size="size-5" />
              <span className="min-w-0 truncate">
                {person.name}
                {person.userId === viewerId && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <Tick on={value === person.userId} />
            </PopoverClose>
          ))}
          {!candidates.length && <p className="text-muted-foreground px-2 py-1.5 text-sm">Nobody matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function LabelsPicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & { value: readonly string[]; onChange: (labelIds: string[]) => void }) {
  const { labels, canEdit } = useWorkDirectory();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [color, setColor] = useState<WorkColor>("blue");
  const q = query.trim();
  const shown = labels.filter((label) => !q || label.name.toLowerCase().includes(q.toLowerCase()));
  const exact = labels.some((label) => label.name.toLowerCase() === q.toLowerCase());
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const create = async () => {
    setCreating(true);
    const result = await createTaskLabelAction(q, color);
    setCreating(false);
    if (!result.ok) return toast.error(result.error);
    setQuery("");
    onChange([...value, result.value.id]);
  };
  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-64 p-1.5">
        <SearchBox value={query} onChange={setQuery} label="Labels…" />
        <div className="max-h-64 overflow-y-auto" role="group" aria-label="Labels">
          {shown.map((label) => (
            <button key={label.id} type="button" className={ROW} onClick={() => toggle(label.id)} aria-pressed={value.includes(label.id)}>
              <ColorDot color={label.color} />
              <span className="min-w-0 truncate">{label.name}</span>
              <Tick on={value.includes(label.id)} />
            </button>
          ))}
          {!shown.length && !q && <p className="text-muted-foreground px-2 py-1.5 text-sm">No labels yet.</p>}
        </div>
        {canEdit && q && !exact && (
          <div className="border-alpha-medium mt-1.5 space-y-1.5 border-t pt-1.5">
            <SwatchRadioGroup
              label="Label colour"
              value={color}
              onValueChange={setColor}
              className="px-1"
              itemClassName="rounded-full p-1 data-[checked]:ring-2 data-[checked]:ring-ring/50"
              options={WORK_COLORS.map((c) => ({ value: c, label: c, content: <ColorDot color={c} className="size-3" /> }))}
            />
            <button type="button" className={ROW} onClick={create} disabled={creating}>
              <Plus aria-hidden className="size-4" /> Create “{q}”
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ProjectPicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & { value: string; onChange: (projectId: string) => void }) {
  const { projects } = useWorkDirectory();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const open = projects.filter((p) => p.status !== "completed" && (!q || p.name.toLowerCase().includes(q)));
  return (
    <Popover onOpenChange={(o) => !o && setQuery("")}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-64 p-1.5">
        <SearchBox value={query} onChange={setQuery} label="Move to project…" />
        <div className="max-h-64 overflow-y-auto">
          {open.map((project) => (
            <PopoverClose key={project.id} render={<button type="button" />} className={ROW} onClick={() => onChange(project.id)} aria-pressed={value === project.id}>
              <ProjectGlyph icon={project.icon} color={project.color} />
              <span className="min-w-0 truncate">{project.name}</span>
              <span className="text-muted-foreground ml-auto font-mono text-xs">{project.key}</span>
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toDate(day: string | null): Date | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function fromDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Next Monday from `today`, the "Next week" chip. */
function nextMonday(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, ((8 - day) % 7) || 7);
}

export function DatePickerPopover({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
  label,
}: PickerProps & { value: string | null; onChange: (day: string | null) => void; label: string }) {
  const { today } = useWorkDirectory();
  const [open, setOpen] = useState(false);
  const pick = (day: string | null) => {
    onChange(day);
    setOpen(false);
  };
  const chips: [string, string | null][] = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", nextMonday(today)],
    ["In 2 weeks", addDays(today, 14)],
    ["Clear", null],
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-auto p-2" aria-label={label}>
        <div className="mb-1 flex flex-wrap gap-1">
          {chips.map(([text, day]) => (
            <Button key={text} size="sm" variant="ghost" onClick={() => pick(day)} disabled={day === null && !value}>
              {text}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={toDate(value)}
          defaultMonth={toDate(value) ?? toDate(today)}
          onSelect={(date) => date && pick(fromDate(date))}
        />
      </PopoverContent>
    </Popover>
  );
}

export function RecurrencePicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & { value: TaskRecurrence | null; onChange: (value: TaskRecurrence | null) => void }) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-52 p-1">
        <PopoverClose render={<button type="button" />} className={ROW} onClick={() => onChange(null)} aria-pressed={value === null}>
          Does not repeat
          <Tick on={value === null} />
        </PopoverClose>
        {TASK_RECURRENCES.map((recurrence) => (
          <PopoverClose key={recurrence} render={<button type="button" />} className={ROW} onClick={() => onChange(recurrence)} aria-pressed={value === recurrence}>
            {TASK_RECURRENCE_LABELS[recurrence]}
            <Tick on={value === recurrence} />
          </PopoverClose>
        ))}
        <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs">The next copy is created when this one is completed.</p>
      </PopoverContent>
    </Popover>
  );
}

export function EstimatePicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & { value: number | null; onChange: (minutes: number | null) => void }) {
  const [text, setText] = useState(formatEstimate(value));
  const [open, setOpen] = useState(false);
  const parsed = parseEstimate(text);
  const commit = (minutes: number | null) => {
    onChange(minutes);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setText(formatEstimate(value)); }}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-56 p-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() && parsed === null) return;
            commit(parsed);
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g. 2h, 1d 4h"
            aria-label="Estimate"
            aria-invalid={Boolean(text.trim()) && parsed === null}
            autoFocus
            className="h-8"
          />
        </form>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {ESTIMATE_PRESETS.map((minutes) => (
            <Button key={minutes} size="sm" variant={value === minutes ? "secondary" : "ghost"} onClick={() => commit(minutes)}>
              {formatEstimate(minutes)}
            </Button>
          ))}
        </div>
        {value !== null && (
          <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => commit(null)}>
            Clear estimate
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function BlockedByPicker({
  value,
  candidates,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & {
  value: readonly string[];
  /** Tasks of the same Project, minus the Task itself. */
  candidates: readonly Task[];
  onChange: (ids: string[]) => void;
}) {
  const { keyOf } = useWorkDirectory();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = candidates.filter(
    (task) => !q || task.title.toLowerCase().includes(q) || keyOf(task).toLowerCase().includes(q)
  );
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <Popover onOpenChange={(o) => !o && setQuery("")}>
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-72 p-1.5">
        <SearchBox value={query} onChange={setQuery} label="Blocked by…" />
        <div className="max-h-64 overflow-y-auto" role="group" aria-label="Blocked by">
          {shown.map((task) => (
            <button key={task.id} type="button" className={ROW} onClick={() => toggle(task.id)} aria-pressed={value.includes(task.id)}>
              <TaskStatusIcon status={task.status} />
              <span className="text-muted-foreground font-mono text-xs">{keyOf(task)}</span>
              <span className="min-w-0 truncate">{task.title}</span>
              <Tick on={value.includes(task.id)} />
            </button>
          ))}
          {!shown.length && <p className="text-muted-foreground px-2 py-1.5 text-sm">No other tasks in this project.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Resolves (ADR-0027 rule 2): the Improvement this Task fixes, picked from the
 * open ones, or None to unlink. The list is read when the picker opens, not
 * with the Task: most Tasks never open it, and the board can be long.
 */
export function ImprovementPicker({
  value,
  onChange,
  trigger,
  disabled,
  align = "start",
}: PickerProps & {
  /** The linked Improvement, kept in the list even once it is no longer open. */
  value: { id: string; seq: number; title: string } | null;
  onChange: (improvementId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ResolvableImprovement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    setFailed(false);
    const result = await listOpenImprovementsAction().catch(() => null);
    if (result?.ok) setOptions(result.value);
    else setFailed(true);
  };
  const listed = options ?? [];
  const all = value && !listed.some((improvement) => improvement.id === value.id) ? [value, ...listed] : listed;
  const shown = all.filter((improvement) => matchesImprovement(improvement, query));
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) void load();
        else setQuery("");
      }}
    >
      <PopoverTrigger render={trigger} disabled={disabled} />
      <PopoverContent align={align} className="w-80 p-1.5">
        <SearchBox value={query} onChange={setQuery} label="Resolves…" />
        <div className="max-h-64 overflow-y-auto" aria-busy={options === null && !failed}>
          <PopoverClose render={<button type="button" />} className={cn(ROW, "text-muted-foreground")} onClick={() => value !== null && onChange(null)} aria-pressed={value === null}>
            None
            <Tick on={value === null} />
          </PopoverClose>
          {shown.map((improvement) => (
            <PopoverClose
              key={improvement.id}
              render={<button type="button" />}
              className={ROW}
              onClick={() => improvement.id !== value?.id && onChange(improvement.id)}
              aria-pressed={value?.id === improvement.id}
            >
              <span className="text-muted-foreground shrink-0 font-mono text-xs">IMP-{improvement.seq}</span>
              <span className="min-w-0 truncate">{improvement.title}</span>
              <Tick on={value?.id === improvement.id} />
            </PopoverClose>
          ))}
          {failed ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">Could not load improvements.</p>
          ) : options === null ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">Loading improvements…</p>
          ) : (
            !shown.length && (
              <p className="text-muted-foreground px-2 py-1.5 text-sm">
                {query.trim() ? "Nothing matches." : "No open improvements."}
              </p>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A label beside its picker trigger (a `PillButton`), the drawer's properties grid cell. */
export function PropertyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SpringSpan className="flex min-h-9 items-center justify-between gap-3">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </SpringSpan>
  );
}
