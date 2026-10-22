"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import type { Project, ProjectStatus, WorkColor } from "@agent-hub/core";
import { PROJECT_ICONS, PROJECT_STATUSES, WORK_COLORS, deriveProjectKey } from "@agent-hub/core";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { toast } from "@/lib/toast";
import { PROJECT_STATUS_LABELS } from "@/lib/work/work-format";
import { createWorkProjectAction, updateWorkProjectAction } from "@/app/work-actions";
import { ColorDot, projectIcon } from "./work-icons";
import { useWorkDirectory } from "./work-directory";
import { SwatchRadioGroup } from "./work-ui";
import { ProjectVisibilityChoice } from "./project-visibility-choice";

/**
 * Create or edit a Project's own fields (#1046): name, key, description,
 * status, lead, dates, colour, icon and who can see it. The decisions document
 * keeps its own editor; this is the container's settings.
 */
export function ProjectFormDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  /** Editing this one; absent creates. */
  project?: Project;
}) {
  const router = useRouter();
  const dir = useWorkDirectory();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(Boolean(project));
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "planning");
  const [leadId, setLeadId] = useState<string>(project?.leadId ?? "");
  const [startDate, setStartDate] = useState<string>(project?.startDate ?? "");
  const [dueDate, setDueDate] = useState<string>(project?.dueDate ?? "");
  const [color, setColor] = useState<WorkColor>(project?.color ?? "blue");
  const [icon, setIcon] = useState<string>(project?.icon ?? "folder");
  const [visibility, setVisibility] = useState<Project["visibility"]>(project?.visibility ?? "organization");

  const suggestedKey = deriveProjectKey(name, dir.projects.filter((p) => p.id !== project?.id).map((p) => p.key));
  const shownKey = keyTouched ? key : suggestedKey;

  const submit = () =>
    startTransition(async () => {
      const fields = {
        name: name.trim(),
        description,
        key: shownKey,
        status,
        leadId: leadId || null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        color,
        icon: icon as (typeof PROJECT_ICONS)[number],
        visibility,
      };
      const result = project
        ? await updateWorkProjectAction({ id: project.id, patch: fields })
        : await createWorkProjectAction(fields);
      if (!result.ok) return toast.error(result.error);
      toast.success(project ? "Project saved" : "Project created");
      onClose();
      if (!project) router.push(`/projects/${result.value.id}/list`);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{project ? "Project settings" : "New project"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) submit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && name.trim()) submit();
          }}
        >
          <DialogBody>
            <DialogSection>
              <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="project-name">Name</Label>
                  <Input id="project-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="project-key">Key</Label>
                  <Input
                    id="project-key"
                    value={shownKey}
                    maxLength={5}
                    className="font-mono uppercase"
                    onChange={(e) => {
                      setKeyTouched(true);
                      setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                    }}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">Task keys start with it, like {shownKey || "WEB"}-12.</p>
              <div className="space-y-1.5">
                <Label htmlFor="project-description">Description</Label>
                <Textarea id="project-description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </DialogSection>
            <DialogSection>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                    <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Lead</Label>
                  <Select value={leadId || "none"} onValueChange={(v) => setLeadId(v === "none" ? "" : String(v))}>
                    <SelectTrigger aria-label="Lead"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No lead</SelectItem>
                      {dir.people.map((p) => (
                        <SelectItem key={p.userId} value={p.userId}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Start</Label>
                  <DatePicker label="Start date" value={startDate || null} allowClear onChange={setStartDate} />
                </div>
                <div className="space-y-1.5">
                  <Label>Target</Label>
                  <DatePicker label="Target date" value={dueDate || null} allowClear onChange={setDueDate} />
                </div>
              </div>
            </DialogSection>
            <DialogSection>
              <div className="space-y-1.5">
                <Label>Colour</Label>
                <SwatchRadioGroup
                  label="Colour"
                  value={color}
                  onValueChange={setColor}
                  className="gap-1.5"
                  itemClassName="rounded-full p-1.5 data-[checked]:ring-2 data-[checked]:ring-ring/50"
                  options={WORK_COLORS.map((c) => ({ value: c, label: c, content: <ColorDot color={c} className="size-3.5" /> }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <SwatchRadioGroup
                  label="Icon"
                  value={icon}
                  onValueChange={setIcon}
                  className="grid grid-cols-8 gap-1"
                  itemClassName="hover:bg-alpha-light flex aspect-square items-center justify-center rounded-lg data-[checked]:bg-alpha-strong"
                  options={PROJECT_ICONS.map((name) => {
                    const Icon = projectIcon(name);
                    return { value: name, label: name, content: <Icon className="size-4" /> };
                  })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Who can see it</Label>
                <ProjectVisibilityChoice value={visibility} onChange={setVisibility} />
              </div>
            </DialogSection>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {project ? "Save" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
