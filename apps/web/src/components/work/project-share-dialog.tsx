"use client";

import { useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
} from "@agent-hub/ui";
import type { Project } from "@agent-hub/core";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "@/lib/toast";
import { setProjectMembersAction, updateWorkProjectAction } from "@/app/work-actions";
import { AssigneePicker } from "./task-pickers";
import { useWorkDirectory } from "./work-directory";
import { ProjectVisibilityChoice } from "./project-visibility-choice";

/**
 * Share (#1047): who can see a Project. Organization-wide, or private to a
 * list of existing Members (Owners and Admins always see it). No per-project
 * permission levels and no Guests: inside the Project, a Member's Role still
 * decides what they may do.
 */
export function ProjectShareDialog({
  open,
  onClose,
  project,
  memberIds,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  memberIds: string[];
}) {
  const dir = useWorkDirectory();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState(project.visibility);
  const [members, setMembers] = useState<string[]>(() =>
    memberIds.length ? memberIds : project.createdBy ? [project.createdBy] : [dir.viewerId]
  );
  const people = useMemo(() => members.map((id) => dir.person(id)).filter(Boolean), [members, dir]);

  const save = () =>
    startTransition(async () => {
      if (visibility === "private") {
        const seated = await setProjectMembersAction(project.id, members);
        if (!seated.ok) return toast.error(seated.error);
      }
      if (visibility !== project.visibility) {
        const result = await updateWorkProjectAction({ id: project.id, patch: { visibility } });
        if (!result.ok) return toast.error(result.error);
      }
      toast.success("Sharing saved");
      onClose();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {project.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogSection>
            <ProjectVisibilityChoice label="General access" value={visibility} onChange={setVisibility} />
          </DialogSection>
          {visibility === "private" && (
            <DialogSection>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">People with access</p>
                <AssigneePicker
                  value={null}
                  onChange={(id) => id && !members.includes(id) && setMembers([...members, id])}
                  trigger={<Button size="sm" variant="secondary">Add people</Button>}
                />
              </div>
              <ul className="flex flex-col gap-1">
                {people.map((person) =>
                  person ? (
                    <li key={person.userId} className="flex items-center gap-2 rounded-lg px-1 py-1">
                      <UserAvatar userId={person.userId} email={person.email} avatarUrl={person.avatarUrl} size="size-6" />
                      <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
                      <span className="text-muted-foreground text-xs capitalize">{person.role}</span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${person.name}`}
                        disabled={members.length === 1}
                        onClick={() => setMembers(members.filter((id) => id !== person.userId))}
                      >
                        <X className="size-4" />
                      </Button>
                    </li>
                  ) : null
                )}
              </ul>
              <p className="text-muted-foreground text-xs">Owners and Admins can always see a private project.</p>
            </DialogSection>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
